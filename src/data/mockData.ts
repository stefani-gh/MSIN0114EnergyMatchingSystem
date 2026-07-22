import {
  BarChart3,
  Database,
  FileCheck2,
  LogOut,
  Menu,
} from 'lucide-react'

export type RoleName = string

export const pagePrivileges = [
  {
    key: 'dashboard',
    label: 'Dashboard Home',
    path: '/dashboard',
    readPermission: 'Read Dashboard Home',
    maintainPermission: 'Maintain Dashboard Home',
  },
  {
    key: 'data-upload',
    label: 'Data Upload',
    path: '/data-upload',
    readPermission: 'Read Data Upload',
    maintainPermission: 'Maintain Data Upload',
  },
  {
    key: 'results',
    label: 'Results',
    path: '/results',
    readPermission: 'Read Results',
    maintainPermission: 'Maintain Results',
  },
  {
    key: 'download-templates',
    label: 'Download Templates',
    path: '/download-templates',
    readPermission: 'Read Download Templates',
    maintainPermission: 'Maintain Download Templates',
  },
  {
    key: 'customer',
    label: 'Customer Creation',
    path: '/customer',
    readPermission: 'Read Customer Creation',
    maintainPermission: 'Maintain Customer Creation',
  },
  {
    key: 'generator',
    label: 'Generator Creation',
    path: '/generator',
    readPermission: 'Read Generator Creation',
    maintainPermission: 'Maintain Generator Creation',
  },
  {
    key: 'business-group',
    label: 'Business Group',
    path: '/business-group',
    readPermission: 'Read Business Group',
    maintainPermission: 'Maintain Business Group',
  },
  {
    key: 'how-to-use',
    label: 'How to Use',
    path: '/how-to-use',
    readPermission: 'Read How to Use',
    maintainPermission: 'Maintain How to Use',
  },
  {
    key: 'settings',
    label: 'User Settings',
    path: '/settings',
    readPermission: 'Read User Settings',
    maintainPermission: 'Maintain User Settings',
  },
  {
    key: 'manage-users',
    label: 'Manage User',
    path: '/system-setting/manage-users',
    readPermission: 'Read Manage User',
    maintainPermission: 'Maintain Manage User',
  },
  {
    key: 'manage-role',
    label: 'Manage Role',
    path: '/system-setting/manage-role',
    readPermission: 'Read Manage Role',
    maintainPermission: 'Maintain Manage Role',
  },
  {
    key: 'audit-logs',
    label: 'Audit Logs',
    path: '/system-setting/audit-logs',
    readPermission: 'Read Audit Logs',
    maintainPermission: 'Maintain Audit Logs',
  },
  {
    key: 'database',
    label: 'Database',
    path: '/system-setting/database',
    readPermission: 'Read Database',
    maintainPermission: 'Maintain Database',
  },
] as const

export type PagePrivilegeKey = (typeof pagePrivileges)[number]['key']
export type PermissionName =
  | (typeof pagePrivileges)[number]['readPermission']
  | (typeof pagePrivileges)[number]['maintainPermission']

export type ManagedUser = {
  id: string
  username: string
  email: string
  role: RoleName
  businessGroupId?: string
}

export type UploadedFileAdmin = {
  fileName: string
  type: 'Consumption' | 'Generation'
  owner: string
  uploadedAt: string
  status: 'Validated' | 'Processing' | 'Archived'
}

export type BusinessGroup = {
  id: string
  name: string
  toUserIds: string[]
  ccUserIds: string[]
}

export type AuditLog = {
  user: string
  action: string
  details: string
  modifiedAt: string
  createdAt: string
}

export const rolesList: RoleName[] = ['Standard user', 'Admin']

export const permissionList = pagePrivileges.flatMap((page) => [
  page.readPermission,
  page.maintainPermission,
]) as PermissionName[]

export const initialBusinessGroups: BusinessGroup[] = []

export const initialUsers: ManagedUser[] = [
  {
    id: 'u-1',
    username: 'admin.user',
    email: 'admin.user@example-energy.co.uk',
    role: 'Admin',
  },
  {
    id: 'u-2',
    username: 'standard.user',
    email: 'standard.user@example-energy.co.uk',
    role: 'Standard user',
  },
  {
    id: 'u-3',
    username: 'business.reviewer',
    email: 'business.reviewer@example-energy.co.uk',
    role: 'Standard user',
  },
]

export const adminUploadedFiles: UploadedFileAdmin[] = [

]

export const auditLogs: AuditLog[] = [

]

export const templateRequirements = [
  {
    template: 'Generation template',
    columns: 'Site ID, meter ID, date, half-hour interval, generation kWh',
    format: '.xlsx, .xls, .csv',
  },
  {
    template: 'Consumption template',
    columns: 'Customer ID, meter ID, date, half-hour interval, consumption kWh',
    format: '.xlsx, .xls, .csv',
  },
]

export const userInterfaceSteps = [
  {
    title: 'Log in',
    copy: 'Use your username and password to log in to the system. If you forget your password, click "Forget Password" to reset your password.',
  },
  {
    title: 'Log out',
    inlineIcon: LogOut,
    copy: 'Click the "Logout" button *IMAGE on the top right corner to log out of the system.',
  },
  {
    title: 'Sidebar Menu',
    inlineIcon: Menu,
    copy:
      'The menu button *IMAGE is in the top-left corner. Click it to open the sidebar menu and navigate to other pages. Click the menu button *IMAGE again to hide the sidebar menu.',
  },
  {
    title: 'Business Group ',
    copy: 'Go to "Business Group" to create a new business group if you want to send the matching results to a group of business users everytime.',
  },
  {
    title: 'Customer / Generator Creation',
    copy: 'Go to "Customer Creation" or "Generator Creation" to set up the customer or generator information (e.g. Site ID, MPAN) before running portfolio-level energy matching.',
  },
  {
    title: 'User Settings',
    copy: 'Go to "User Settings" on the menu to change your username, email, and password if necessary. If you wish to change your Role, contat your IT administrator.',
  },
]

export const userJourneySteps = [
  {
    title: 'Download Template',
    copy: 'Download the generation and consumption templates from the "Download Templates" page to your computer to prepare the data.',
  },
  {
    title: 'Prepare Data',
    copy: 'Fill in the Site ID, MPAN, Date, Half-hour interval energy consumption/ generation fields using the templates you downloaded.',
  },
  {
    title: 'Data Upload',
    copy: 'Upload the consumption and generation files through the "Data Upload" page.',
  },
  {
    title: 'Review Results',
    copy: 'After the data is uploaded, you can review the results on the "Results" page.',
  },
]

export const quickActions = [
  {
    title: 'Download templates',
    description: 'Start with the approved import structure.',
    icon: FileCheck2,
    path: '/download-templates',
  },
  {
    title: 'Upload data',
    description: 'Simulate adding consumption and generation files.',
    icon: Database,
    path: '/data-upload',
  },
  {
    title: 'View results',
    description: 'Open the half-hourly matching dashboard.',
    icon: BarChart3,
    path: '/results',
  },
]
