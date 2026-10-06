// Adapted from https://github.com/antvis/G2/blob/v5/site/docs/charts/sunburst.en.mdx
// See ../../UPSTREAM-LICENSE.txt for upstream license.

export default async function draw(context) {
  const { Chart, asset } = context;
  const G2 = { Chart };
  const Math = context.math;
  const chart = new Chart({
    container: context.container,
    theme: "classic",
    autoFit: true,
  });

  chart.options({
    type: "sunburst",
    data: {
      type: "fetch",
      value: asset(
        "https://gw.alipayobjects.com/os/antvdemo/assets/data/sunburst.json",
      ),
    },
    encode: {
      value: "sum",
    },
    animate: { enter: { type: "waveIn" } },
  });

  chart.render();

  await context.flush();
}
