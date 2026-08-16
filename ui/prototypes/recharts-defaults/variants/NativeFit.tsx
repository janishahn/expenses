import ChartSystemPrototype from "../ChartSystemPrototype"
import type { VariantProps } from "../types"

export default function NativeFit(props: VariantProps) {
  return <ChartSystemPrototype {...props} mode="native" />
}
