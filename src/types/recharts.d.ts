// Type declarations for recharts deep imports. We use these (instead of
// `import { ... } from "recharts"`) to bypass Next.js's automatic barrel
// optimization, which races with OneDrive file sync on Windows. Each entry
// re-exports the matching member from the public package, so we get the
// real types without changing the runtime behavior.

declare module "recharts/es6/cartesian/Area" {
  export { Area } from "recharts";
}
declare module "recharts/es6/cartesian/Bar" {
  export { Bar } from "recharts";
}
declare module "recharts/es6/cartesian/CartesianGrid" {
  export { CartesianGrid } from "recharts";
}
declare module "recharts/es6/cartesian/XAxis" {
  export { XAxis } from "recharts";
}
declare module "recharts/es6/cartesian/YAxis" {
  export { YAxis } from "recharts";
}
declare module "recharts/es6/cartesian/ZAxis" {
  export { ZAxis } from "recharts";
}
declare module "recharts/es6/cartesian/ReferenceLine" {
  export { ReferenceLine } from "recharts";
}
declare module "recharts/es6/cartesian/Scatter" {
  export { Scatter } from "recharts";
}
declare module "recharts/es6/chart/AreaChart" {
  export { AreaChart } from "recharts";
}
declare module "recharts/es6/chart/BarChart" {
  export { BarChart } from "recharts";
}
declare module "recharts/es6/chart/PieChart" {
  export { PieChart } from "recharts";
}
declare module "recharts/es6/chart/ScatterChart" {
  export { ScatterChart } from "recharts";
}
declare module "recharts/es6/polar/Pie" {
  export { Pie } from "recharts";
}
declare module "recharts/es6/component/Cell" {
  export { Cell } from "recharts";
}
declare module "recharts/es6/component/Legend" {
  export { Legend } from "recharts";
}
declare module "recharts/es6/component/Tooltip" {
  export { Tooltip } from "recharts";
}
declare module "recharts/es6/component/ResponsiveContainer" {
  export { ResponsiveContainer } from "recharts";
}
