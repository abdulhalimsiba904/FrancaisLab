export type DocumentType = 'pdf' | 'pptx'

export function getDocumentType(file: File): DocumentType | undefined {
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (extension === 'pdf' || file.type === 'application/pdf') return 'pdf'
  if (extension === 'pptx' || file.type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') return 'pptx'
  return undefined
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
