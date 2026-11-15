export default async function draw(context) {
  const { Chart, asset, fetch } = context;
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
