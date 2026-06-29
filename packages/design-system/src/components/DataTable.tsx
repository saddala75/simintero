// packages/design-system/src/components/DataTable.tsx
import React from 'react'

export interface Column<T> {
  key: string
  header: string
  render?: (row: T) => React.ReactNode
  className?: string
}

export interface DataTableProps<T> {
  columns: Column<T>[]
  data: T[]
  keyExtractor: (row: T) => string
  emptyMessage?: string
  className?: string
  testId?: string
  rowTestId?: (row: T) => string
  onRowClick?: (row: T) => void
}

export function DataTable<T>({
  columns,
  data,
  keyExtractor,
  emptyMessage = 'No records found.',
  className = '',
  testId = 'table-row',
  rowTestId,
  onRowClick,
}: DataTableProps<T>) {
  return (
    <div className={`w-full overflow-x-auto border border-slate-200 rounded-lg shadow-sm ${className}`}>
      <table className="w-full text-left border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 text-xs font-semibold uppercase tracking-wider">
            {columns.map((col) => (
              <th key={col.key} className={`px-4 py-3 ${col.className || ''}`}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 bg-white">
          {data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-8 text-center text-slate-500 text-xs">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            data.map((row) => (
              <tr
                key={keyExtractor(row)}
                data-testid={rowTestId ? rowTestId(row) : testId}
                onClick={() => onRowClick?.(row)}
                className={`hover:bg-slate-50/80 transition-colors ${onRowClick ? 'cursor-pointer' : ''}`}
              >
                {columns.map((col) => (
                  <td key={col.key} className={`px-4 py-3 text-slate-800 ${col.className || ''}`}>
                    {col.render ? col.render(row) : ((row as Record<string, unknown>)[col.key] as React.ReactNode)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
