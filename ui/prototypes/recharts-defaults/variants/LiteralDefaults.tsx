import ChartSystemPrototype from "../ChartSystemPrototype"
import type { VariantProps } from "../types"

export default function LiteralDefaults(props: VariantProps) {
  return <ChartSystemPrototype {...props} mode="literal" />
}
