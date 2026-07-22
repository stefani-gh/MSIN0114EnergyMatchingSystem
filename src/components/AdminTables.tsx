import { adminUploadedFiles, auditLogs } from '../data/mockData'
import { Button, DataTable, StatusBadge } from './ui'

function fileStatusTone(status: string) {
  if (status === 'Validated') return 'green' as const
  if (status === 'Processing') return 'blue' as const
  return 'slate' as const
}

export function UploadedFilesAdminTable() {
  return (
    <DataTable
      columns={['File name', 'Type', 'Owner', 'Uploaded at', 'Status', 'Actions']}
      rows={adminUploadedFiles.map((file) => [
        <span className="font-medium text-slate-950">{file.fileName}</span>,
        file.type,
        file.owner,
        file.uploadedAt,
        <StatusBadge tone={fileStatusTone(file.status)}>{file.status}</StatusBadge>,
        <div className="flex gap-2">
          <Button variant="secondary" disabled>
            Edit
          </Button>
          <Button variant="danger" disabled>
            Delete
          </Button>
        </div>,
      ])}
    />
  )
}

export function AuditLogsTable() {
  return (
    <DataTable
      columns={[
        'User',
        'Action Performed',
        'Details',
        'Modified Date and Time',
        'Created Date and Time',
      ]}
      rows={auditLogs.map((log) => [
        log.user,
        <span className="font-medium text-slate-950">{log.action}</span>,
        log.details,
        log.modifiedAt,
        log.createdAt,
      ])}
    />
  )
}
