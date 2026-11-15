import { translator } from "../../../../i18n";
import messages from "../../../../i18n/messages/g2";

const t = translator(messages);

export default async function draw(context) {
  const { Chart, asset, fetch } = context;
  const G2 = { Chart };
  const Math = context.math;
  const generateNormalData = (count, mean, std) => {
    const data = [];
    for (let i = 0; i < count; i++) {
      const u1 = Math.random();
      const u2 = Math.random();
      const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      data.push({ value: mean + std * z0 });
    }
    return data;
  };

  const chart = new Chart({
    container: context.container,
    theme: "classic",
  });

  chart.options({
    type: "line",
    data: {
      value: generateNormalData(1000, 100, 15),
      transform: [
        {
          type: "custom",
          callback: (data) => {
            const values = data.map((d) => d.value).filter((v) => !isNaN(v));

            if(!values.length)throw new Error(t('error.distributionValue'));
            const low=Math.min(...values), high=Math.max(...values);
            const min = low===high ? low-0.5 : low;
            const max = low===high ? high+0.5 : high;
            const binCount = 30;
            const binWidth = (max - min) / binCount;

            const bins = Array.from({ length: binCount }, (_, i) => ({
              x0: min + i * binWidth,
              x1: min + (i + 1) * binWidth,
              count: 0,
            }));

            values.forEach((value) => {
              const binIndex = Math.min(
                Math.floor((value - min) / binWidth),
                binCount - 1,
              );
              bins[binIndex].count++;
            });

            const total = values.length;
            return bins.map((bin) => ({
              x: (bin.x0 + bin.x1) / 2,
              y: bin.count / total,
              frequency: bin.count,
              range: `${bin.x0.toFixed(1)}-${bin.x1.toFixed(1)}`,
            }));
          },
        },
      ],
    },
    encode: {
      x: "x",
      y: "y",
      shape: "smooth",
    },
    style: {
      lineWidth: 3,
      stroke: "#1890ff",
    },
    axis: {
      x: { title: "Measured Value" },
      y: { title: "Frequency Density" },
    },
    tooltip: {
      title: (d) => `Range: ${d.range}`,
      items: [
        { field: "frequency", name: "Frequency" },
        { field: "y", name: "Frequency Density", valueFormatter: ".3f" },
      ],
    },
  });

  chart.render();

  await context.flush();
}
