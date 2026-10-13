import { useEffect, useRef, type ReactNode } from "react"
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core"
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { DotsSixVerticalIcon } from "@phosphor-icons/react/DotsSixVertical"
import clsx from "clsx"
import { List } from "./LedgerRow"
import { columnStyle, rowProps, type RowProps } from "./row-layout"
import s from "./kit.module.css"

// Rows the user drags into order by their grip, with the pointer or the keyboard
// (Space to lift, arrows to move, Space to drop). The grip stays focused after a move.
export function SortableList({
  ids,
  onReorder,
  label,
  children,
}: {
  ids: number[]
  onReorder: (ids: number[]) => void
  label: string
  children: ReactNode
}) {
  const moved = useRef<number | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )
  useEffect(() => {
    if (moved.current === null) return
    const id = moved.current
    moved.current = null
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-sort-id="${id}"]`)?.focus())
  }, [ids])
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const from = ids.indexOf(Number(active.id))
    const to = ids.indexOf(Number(over.id))
    if (from === -1 || to === -1) return
    moved.current = Number(active.id)
    onReorder(arrayMove(ids, from, to))
  }
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <List label={label}>{children}</List>
      </SortableContext>
    </DndContext>
  )
}

// A row of a SortableList; its first column is the grip.
export function SortableRow({
  id,
  disabled = false,
  children,
  ...props
}: Omit<RowProps, "dim"> & { id: number; label: string; disabled?: boolean }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled })
  return (
    <div
      ref={setNodeRef}
      className={clsx(s.row, isDragging && s.rowDragging)}
      style={{ ...columnStyle(props), transform: CSS.Transform.toString(transform), transition }}
      {...rowProps(props)}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        className={s.grip}
        aria-label={`Reorder ${props.label}`}
        data-sort-id={id}
        disabled={disabled}
        {...attributes}
        {...listeners}
      >
        <DotsSixVerticalIcon aria-hidden="true" />
      </button>
      {children}
    </div>
  )
}
