import { CompiledInkKernel } from "./compiled-ink.mjs";
const operations = { M: [0, 2], L: [1, 2], Q: [2, 4], C: [3, 6], Z: [4, 0] };
/** Retained, detached geometry from the shared native/WASM analytic path ABI.
 * See include/analytic-path.h for the signed stencil / rare ray-mode contract.
 * This API does not change portable ink v1 or flatten its mask/hit semantics. */
export class AnalyticPathKernel {
  constructor() {
    this.kernel = new CompiledInkKernel();
    this.api = this.kernel.api;
    if (
      this.api.sa_analytic_abi_version() !== 1 ||
      this.api.sa_analytic_sizeof_patch() !== 120 ||
      this.api.sa_analytic_sizeof_vertex() !== 20
    )
      throw new Error("Unsupported analytic path ABI");
  }
  input(commands, affine, budget) {
    if (
      !Array.isArray(commands) ||
      commands.length > 100000 ||
      !Array.isArray(affine) ||
      affine.length !== 6 ||
      affine.some((x) => !Number.isFinite(x))
    )
      throw new Error("Invalid analytic path input");
    const k = this.kernel;
    k.reset();
    const command = k.allocate(commands.length * 56),
      transform = k.allocate(48),
      limit = k.allocate(16);
    const view = new DataView(this.api.memory.buffer);
    commands.forEach((c, i) => {
      const spec = operations[c?.[0]];
      if (
        !Array.isArray(c) ||
        !spec ||
        c.length !== spec[1] + 1 ||
        c.slice(1).some((x) => typeof x !== "number" || !Number.isFinite(x))
      )
        throw new Error("Invalid analytic path command");
      const at = command + i * 56;
      view.setUint32(at, spec[0], true);
      view.setUint32(at + 4, 0, true);
      for (let j = 0; j < 6; j++)
        view.setFloat64(at + 8 + j * 8, c[j + 1] ?? 0, true);
    });
    new Float64Array(this.api.memory.buffer, transform, 6).set(affine);
    const maxCommands = budget.maxCommands ?? 100000,
      maxPatches = budget.maxPatches ?? 1000000,
      maxDepth = budget.maxDepth ?? 16;
    if (
      [maxCommands, maxPatches, maxDepth].some(
        (x) => !Number.isInteger(x) || x < 1 || x > 0xffffffff,
      )
    )
      throw new RangeError("Invalid analytic path budget");
    new Uint32Array(this.api.memory.buffer, limit, 4).set([
      maxCommands,
      maxPatches,
      maxDepth,
      0,
    ]);
    return { command, transform, limit };
  }
  build(commands, affine = [1, 0, 0, 1, 0, 0], budget = {}) {
    const k = this.kernel,
      { command, transform, limit } = this.input(commands, affine, budget),
      count = k.allocate(16);
    k.check(
      this.api.sa_analytic_path_counts(
        command,
        commands.length,
        transform,
        limit,
        count,
      ),
    );
    const counts = Array.from(
        new Uint32Array(this.api.memory.buffer, count, 4),
      ),
      patch = k.allocate(counts[0] * 120),
      vertex = k.allocate(counts[1] * 20);
    k.check(
      this.api.sa_analytic_path_build(
        command,
        commands.length,
        transform,
        limit,
        patch,
        counts[0],
        vertex,
        counts[1],
        count,
      ),
    );
    const view = new DataView(this.api.memory.buffer),
      patches = Array.from({ length: counts[0] }, (_, i) => {
        const at = patch + i * 120;
        return {
          origin: [view.getFloat64(at, true), view.getFloat64(at + 8, true)],
          controls: Array.from({ length: 8 }, (_, j) =>
            view.getFloat64(at + 16 + j * 8, true),
          ),
          parameterStart: view.getFloat64(at + 80, true),
          parameterEnd: view.getFloat64(at + 88, true),
          firstVertex: view.getUint32(at + 96, true),
          vertexCount: view.getUint32(at + 100, true),
          commandIndex: view.getUint32(at + 104, true),
          mode: view.getUint32(at + 108, true),
          winding: view.getInt32(at + 112, true),
          sign: view.getFloat32(at + 116, true),
        };
      });
    return {
      patches,
      vertices: new Float32Array(
        this.api.memory.buffer,
        vertex,
        counts[1] * 5,
      ).slice(),
      rayPatches: counts[2],
    };
  }
  pathWinding(commands, point, affine = [1, 0, 0, 1, 0, 0], fill = 0) {
    const k = this.kernel,
      { command, transform } = this.input(commands, affine, {}),
      out = k.allocate(16);
    k.check(
      this.api.sa_analytic_path_winding(
        command,
        commands.length,
        transform,
        point[0],
        point[1],
        fill,
        out,
      ),
    );
    return this.readHit(out);
  }
  readHit(at) {
    const v = new DataView(this.api.memory.buffer);
    return {
      winding: v.getInt32(at, true),
      inside: v.getUint32(at + 4, true) !== 0,
      boundary: v.getUint32(at + 8, true) !== 0,
    };
  }
  meshWinding(mesh, points, fill = 0) {
    const k = this.kernel;
    k.reset();
    const p = k.allocate(mesh.patches.length * 120),
      v = k.allocate(mesh.vertices.byteLength),
      out = k.allocate(16);
    const view = new DataView(this.api.memory.buffer);
    mesh.patches.forEach((q, i) => {
      const at = p + i * 120;
      [...q.origin, ...q.controls, q.parameterStart, q.parameterEnd].forEach(
        (x, j) => view.setFloat64(at + j * 8, x, true),
      );
      [q.firstVertex, q.vertexCount, q.commandIndex, q.mode].forEach((x, j) =>
        view.setUint32(at + 96 + j * 4, x, true),
      );
      view.setInt32(at + 112, q.winding, true);
      view.setFloat32(at + 116, q.sign, true);
    });
    new Float32Array(this.api.memory.buffer, v, mesh.vertices.length).set(
      mesh.vertices,
    );
    return points.map((point) => {
      k.check(
        this.api.sa_analytic_mesh_winding(
          p,
          mesh.patches.length,
          v,
          mesh.vertices.length / 5,
          point[0],
          point[1],
          fill,
          out,
        ),
      );
      return this.readHit(out);
    });
  }
}
