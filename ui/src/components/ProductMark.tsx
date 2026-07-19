type ProductMarkProps = {
  className?: string
}

function ProductMark({ className = "" }: ProductMarkProps) {
  return (
    <span
      aria-hidden="true"
      className={`product-mark ${className}`.trim()}
    >
      <i />
      <i />
      <i />
      <i />
    </span>
  )
}

export default ProductMark
