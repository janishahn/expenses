import { QuestionIcon } from "@phosphor-icons/react/Question"
import clsx from "clsx"
import { CategoryIconSvg } from "../CategoryIcon"
import s from "./kit.module.css"
import { categoryColor } from "./tokens"

export function CategoryGlyph({
  categoryId,
  icon,
  name,
  inline = false,
}: {
  categoryId: number | null | undefined
  icon: string | null | undefined
  name: string | null | undefined
  // Inline glyphs sit before text in cells, pills, and tags.
  inline?: boolean
}) {
  return (
    <span
      aria-hidden="true"
      className={clsx(s.glyph, inline && s.glyphInline)}
      style={{ color: categoryColor(categoryId) }}
    >
      <CategoryIconSvg icon={icon ?? null} label={name} />
    </span>
  )
}

// The glyph of a row that has no category or suggestion yet.
export function UnknownGlyph() {
  return (
    <span aria-hidden="true" className={clsx(s.glyph, s.faint)}>
      <QuestionIcon />
    </span>
  )
}
