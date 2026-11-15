import { feature } from "topojson-client";

export default async function draw(context) {
  const { Chart, asset, fetch } = context;
  const G2 = { Chart };
  const Math = context.math;
  await Promise.all([
    fetch(asset("https://assets.antv.antgroup.com/g2/us-10m.json")).then(
      (res) => res.json(),
    ),
    fetch(asset("https://assets.antv.antgroup.com/g2/unemployment2.json")).then(
      (res) => res.json(),
    ),
  ]).then(([us, unemployment]) => {
    const counties = feature(us, us.objects.states).features;

    const chart = new Chart({
      container: context.container,
      autoFit: true,
    });

    chart.options({
      type: "geoPath",
      coordinate: {
        type: "albersUsa",
      },
      data: {
        value: counties,
        transform: [
          {
            type: "join",
            join: unemployment,
            on: ["id", "id"],
            select: ["rate","state"],
          },
        ],
      },
      scale: {
        color: {
          palette: "ylGnBu",
          unknown: "#fff",
        },
      },
      encode: {
        color: "rate",
      },
      legend: {
        color: {
          layout: { justifyContent: "center" },
        },
      },
      style: {
        stroke: "#666",
        strokeWidth: 0.5,
      },
      tooltip: {
        title: (d) => d.state??String(d.id),
        items: [{ field: "rate", name: "Unemployment Rate" }],
      },
    });

    chart.render();
  });

  await context.flush();
}
