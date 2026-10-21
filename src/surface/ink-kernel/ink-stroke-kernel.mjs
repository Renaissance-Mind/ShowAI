import { CompiledInkKernel } from "./compiled-ink.mjs";
const names = ["M", "L", "Q", "C", "Z"],
  arity = [2, 2, 4, 6, 0];
const fields = [
  "commands",
  "contours",
  "envelopeCurves",
  "fallbackLeaves",
  "sampledChecks",
  "leaves",
  "maximumDepth",
  "fallbackContours",
];
export class CompiledInkStroke {
  constructor() {
    this.kernel = new CompiledInkKernel();
    this.api = this.kernel.api;
    if (
      this.api.sa_stroke_geometry_version() !== 1 ||
      this.api.sa_stroke_sizeof_segment() !== 88 ||
      this.api.sa_stroke_sizeof_options() !== 24 ||
      this.api.sa_stroke_sizeof_result() !== 56
    )
      throw new Error("Unsupported circular stroke ABI");
  }
  input(segments, options) {
    if (
      !Array.isArray(segments) ||
      segments.length > 100000 ||
      Object.keys(options).some(
        (key) =>
          ![
            "tolerance",
            "geometryVersion",
            "maxDepth",
            "maxLeaves",
            "maxCommands",
          ].includes(key),
      )
    )
      throw new Error("Invalid circular stroke input/options");
    const k = this.kernel;
    k.reset();
    const input = k.allocate(segments.length * 88),
      configuration = k.allocate(24),
      view = new DataView(this.api.memory.buffer);
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i],
        at = input + i * 88;
      if (
        !segment ||
        Object.keys(segment).some(
          (key) => !["points", "radius"].includes(key),
        ) ||
        !Array.isArray(segment.points) ||
        segment.points.length < 1 ||
        segment.points.length > 4 ||
        !Array.isArray(segment.radius) ||
        segment.radius.length !== 2
      )
        throw new Error("Invalid circular stroke element");
      for (let j = 0; j < 8; j++) {
        const used = Math.floor(j / 2) < segment.points.length,
          point = segment.points[Math.floor(j / 2)];
        const v = used ? point?.[j % 2] : 0;
        if (
          (used && (!Array.isArray(point) || point.length !== 2)) ||
          typeof v !== "number" ||
          !Number.isFinite(v)
        )
          throw new Error("Invalid circular stroke control");
        view.setFloat64(at + j * 8, v, true);
      }
      for (let j = 0; j < 2; j++) {
        const v = segment.radius[j];
        if (typeof v !== "number" || !Number.isFinite(v))
          throw new Error("Invalid circular stroke radius");
        view.setFloat64(at + 64 + j * 8, v, true);
      }
      view.setUint32(at + 80, segment.points.length - 1, true);
      view.setUint32(at + 84, 0, true);
    }
    const tolerance = options.tolerance ?? 0.02,
      integers = [
        options.geometryVersion ?? 1,
        options.maxDepth ?? 20,
        options.maxLeaves ?? 100000,
        options.maxCommands ?? 1000000,
      ];
    if (
      typeof tolerance !== "number" ||
      !Number.isFinite(tolerance) ||
      integers.some((n) => !Number.isInteger(n) || n < 0 || n > 0xffffffff)
    )
      throw new Error("Invalid circular stroke budget");
    view.setFloat64(configuration, tolerance, true);
    integers.forEach((n, i) =>
      view.setUint32(configuration + 8 + i * 4, n, true),
    );
    return { input, configuration };
  }
  result(at) {
    const view = new DataView(this.api.memory.buffer),
      result = Object.fromEntries(
        fields.map((name, i) => [name, view.getUint32(at + i * 4, true)]),
      );
    return {
      ...result,
      sampledEnvelopeError: view.getFloat64(at + 32, true),
      fallbackCenterBound: view.getFloat64(at + 40, true),
      arcErrorBound: view.getFloat64(at + 48, true),
    };
  }
  counts(segments, options = {}) {
    const { input, configuration } = this.input(segments, options),
      at = this.kernel.allocate(56);
    this.kernel.check(
      this.api.sa_stroke_path_counts(input, segments.length, configuration, at),
    );
    return this.result(at);
  }
  build(segments, options = {}) {
    const { input, configuration } = this.input(segments, options),
      at = this.kernel.allocate(56);
    this.kernel.check(
      this.api.sa_stroke_path_counts(input, segments.length, configuration, at),
    );
    const count = this.result(at).commands,
      output = this.kernel.allocate(count * 56);
    this.kernel.check(
      this.api.sa_stroke_path_build(
        input,
        segments.length,
        configuration,
        output,
        count,
        at,
      ),
    );
    const view = new DataView(this.api.memory.buffer),
      commands = Array.from({ length: count }, (_, i) => {
        const p = output + i * 56,
          op = view.getUint32(p, true);
        return [
          names[op],
          ...Array.from({ length: arity[op] }, (_, j) =>
            view.getFloat64(p + 8 + j * 8, true),
          ),
        ];
      });
    return { commands, result: this.result(at) };
  }
}
