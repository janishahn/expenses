type TransactionDateTimeFieldProps = {
  label?: string
  value: string
  onChange: (value: string) => void
  type?: "date" | "datetime-local"
  required?: boolean
}

function TransactionDateTimeField({
  label = "When",
  value,
  onChange,
  type = "datetime-local",
  required = true,
}: TransactionDateTimeFieldProps) {
  return (
    <label className="form-label">
      <span>{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full field"
        required={required}
      />
    </label>
  )
}

export default TransactionDateTimeField
