import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip as ChartTooltip,
} from "chart.js";

export function installChartComponents() {
  ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, ChartTooltip, Filler);
}
