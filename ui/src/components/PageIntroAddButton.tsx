import { PlusIcon } from "@phosphor-icons/react/Plus"
import type { ComponentProps } from "react"
import { cn } from "@/lib/utils"

type PageIntroAddButtonProps = Omit<ComponentProps<"button">, "children"> & {
  label?: string
}

function PageIntroAddButton({
  label = "Add",
  className,
  type = "button",
  ...props
}: PageIntroAddButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "hidden min-h-9 items-center gap-1.5 rounded-full bg-accent px-3.5 text-sm font-semibold text-bg shadow-[var(--shadow-accent)] transition hover:brightness-110 desk:inline-flex",
        className
      )}
      {...props}
    >
      <PlusIcon className="h-3.5 w-3.5" />
      {label}
    </button>
  )
}

export default PageIntroAddButton
