// Local design rules from DESIGN.md "Enforcement". Loaded by .oxlintrc.json as a JS plugin.

// Tailwind is only the CSS reset; its single utility in use hides text visually but keeps it for assistive technology.
const ALLOWED_CLASSES = new Set(["sr-only"])

// Strings that end up as class names: literals in value positions of conditionals,
// logical fallbacks, arrays, clsx-style calls and objects, never conditions or comparisons.
function classParts(node, parts) {
  switch (node?.type) {
    case "Literal":
      if (typeof node.value === "string") parts.push({ node, text: node.value })
      break
    case "TemplateLiteral":
      for (const quasi of node.quasis) parts.push({ node: quasi, text: quasi.value.cooked ?? "" })
      for (const expression of node.expressions) classParts(expression, parts)
      break
    case "JSXExpressionContainer":
      classParts(node.expression, parts)
      break
    case "ConditionalExpression":
      classParts(node.consequent, parts)
      classParts(node.alternate, parts)
      break
    case "LogicalExpression":
      if (node.operator !== "&&") classParts(node.left, parts)
      classParts(node.right, parts)
      break
    case "CallExpression":
      for (const argument of node.arguments) classParts(argument, parts)
      break
    case "ArrayExpression":
      for (const element of node.elements) classParts(element, parts)
      break
    case "ObjectExpression":
      for (const property of node.properties) {
        if (property.type !== "Property" || property.computed) continue
        if (property.key.type === "Identifier") parts.push({ node: property.key, text: property.key.name })
        else classParts(property.key, parts)
      }
      break
  }
  return parts
}

const noRawVisualClasses = {
  meta: {
    type: "problem",
    docs: { description: "Style through the kit's CSS module, never with literal class names." },
  },
  create(context) {
    return {
      JSXAttribute(node) {
        if (node.name.type !== "JSXIdentifier" || node.name.name !== "className" || !node.value) return
        for (const part of classParts(node.value, [])) {
          const classes = part.text.split(/\s+/).filter((name) => name && !ALLOWED_CLASSES.has(name))
          if (classes.length)
            context.report({
              node: part.node,
              message: `Literal class "${classes.join(" ")}": use a class from kit.module.css, or a variant on the kit primitive.`,
            })
        }
      },
    }
  },
}

export default {
  meta: { name: "design" },
  rules: { "no-raw-visual-classes": noRawVisualClasses },
}
