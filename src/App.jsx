import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  addDoc,
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import * as XLSX from 'xlsx'
import { db, functions } from './firebase/firebase'
import './App.css'

const builtInEntryKeys = ['email', 'emailLower', 'recipientName', 'companyName', 'projectId', 'email_sent', 'active']

const newEntryDefaults = {
  email_sent: 'N',
  active: 'Y',
}

const entriesPerPage = 25

const getEntrySortName = (entry) => (entry.recipientName || '').trim().toLowerCase()

const getEntryNameLetter = (entry) => {
  const name = (entry.recipientName || '').trim()
  if (!name) return '#'
  const firstLetter = name.charAt(0).toUpperCase()
  return /[A-Z]/.test(firstLetter) ? firstLetter : '#'
}

const sortEntriesByName = (entryList) =>
  [...entryList].sort((entryA, entryB) =>
    getEntrySortName(entryA).localeCompare(getEntrySortName(entryB), undefined, {
      sensitivity: 'base',
    })
  )

const entryAlphabetLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

const projectNameToSlug = (name) =>
  String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'project'

const getProjectSlug = (project) => project?.slug || projectNameToSlug(project?.name)

const createUniqueSlug = (name, existingProjects) => {
  const baseSlug = projectNameToSlug(name)
  let slug = baseSlug
  let counter = 2
  const usedSlugs = new Set(existingProjects.map((project) => getProjectSlug(project)))

  while (usedSlugs.has(slug)) {
    slug = `${baseSlug}-${counter}`
    counter += 1
  }

  return slug
}

const isProjectActive = (project) => project?.active !== 'N'

const formatProjectDateCreated = (dateCreated) => {
  if (!dateCreated) return ''

  const date = dateCreated.toDate ? dateCreated.toDate() : new Date(dateCreated)
  if (Number.isNaN(date.getTime())) return ''

  return date.toLocaleDateString()
}

const getProjectTimestamp = (value) => {
  if (!value) return 0

  const date = value.toDate ? value.toDate() : new Date(value)
  const time = date.getTime()

  return Number.isNaN(time) ? 0 : time
}

const sortProjectsByRecentAccess = (projectList) =>
  [...projectList].sort(
    (a, b) =>
      getProjectTimestamp(b.lastAccessedAt || b.dateCreated) -
      getProjectTimestamp(a.lastAccessedAt || a.dateCreated)
  )

const toPlaceholder = (key) => `{{${key}}}`

const fillTemplate = (template, values) => {
  let result = template
  Object.entries(values).forEach(([key, value]) => {
    result = result.replaceAll(toPlaceholder(key), value)
  })
  return result
}

const parseEntryDoc = (entryDoc) => {
  const data = entryDoc.data()
  const fieldValues = {}

  Object.keys(data).forEach((key) => {
    if (!builtInEntryKeys.includes(key)) {
      fieldValues[key] = data[key]
    }
  })

  return {
    id: entryDoc.id,
    email: data.email || '',
    recipientName: data.recipientName || data.companyName || '',
    emailSent: data.email_sent || 'N',
    active: data.active || 'Y',
    fieldValues,
  }
}

const normalizeHeaderName = (header) =>
  String(header || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

const resolveSpreadsheetFieldKey = (header) => {
  const normalized = normalizeHeaderName(header)
  if (['email', 'emailaddress', 'e mail'].includes(normalized)) return 'email'
  if (
    ['recipientname', 'recipient', 'companyname', 'company', 'organization', 'organisation'].includes(
      normalized
    )
  ) {
    return 'recipientName'
  }

  const parts = String(header || '')
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)

  if (parts.length === 0) return ''

  const key =
    parts[0].toLowerCase() +
    parts
      .slice(1)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join('')

  return key.replace(/[^a-zA-Z0-9]/g, '')
}

const buildSpreadsheetColumnMap = (headers) => {
  const columnMap = {}

  headers.forEach((header) => {
    const key = resolveSpreadsheetFieldKey(header)
    if (!key) return
    columnMap[header] = {
      key,
      label: String(header).trim() || key,
    }
  })

  return columnMap
}

const normalizeEmail = (value) => String(value || '').trim().toLowerCase()

const isValidEmail = (value) => {
  const email = String(value || '').trim()
  if (!email || /\s/.test(email)) return false

  const atIndex = email.indexOf('@')
  if (atIndex <= 0 || atIndex !== email.lastIndexOf('@')) return false

  const local = email.slice(0, atIndex)
  const domain = email.slice(atIndex + 1)
  if (!local || !domain || !domain.includes('.')) return false

  const domainParts = domain.split('.')
  if (domainParts.length < 2 || domainParts.some((part) => !part)) return false

  return true
}

const findDuplicateEmailInDatabase = async (databaseName, email, excludeEntryId = null) => {
  const trimmedEmail = String(email || '').trim()
  const emailLower = normalizeEmail(email)
  if (!emailLower) return null

  const findInSnapshot = (snapshot) =>
    snapshot.docs.find((entryDoc) => {
      if (excludeEntryId && entryDoc.id === excludeEntryId) return false
      return entryDoc.data().active !== 'N'
    })

  const lowerSnapshot = await getDocs(
    query(collection(db, databaseName), where('emailLower', '==', emailLower))
  )
  let duplicateDoc = findInSnapshot(lowerSnapshot)

  if (!duplicateDoc && trimmedEmail) {
    const emailSnapshot = await getDocs(
      query(collection(db, databaseName), where('email', '==', trimmedEmail))
    )
    duplicateDoc = findInSnapshot(emailSnapshot)
  }

  if (!duplicateDoc) return null

  return {
    id: duplicateDoc.id,
    email: duplicateDoc.data().email || '',
  }
}

function App() {
  const navigate = useNavigate()
  const { projectSlug } = useParams()
  const [projects, setProjects] = useState([])
  const [projectsReady, setProjectsReady] = useState(false)
  const matchedProject = projects.find(
    (project) => getProjectSlug(project) === projectSlug && isProjectActive(project)
  )
  const activeProjectId = matchedProject?.id || ''
  const activeProjects = sortProjectsByRecentAccess(projects.filter(isProjectActive))
  const [activeProject, setActiveProject] = useState(null)
  const [projectName, setProjectName] = useState('')
  const [databaseName, setDatabaseName] = useState('')
  const [projectError, setProjectError] = useState('')
  const [isSavingProject, setIsSavingProject] = useState(false)

  const [email, setEmail] = useState('')
  const [recipientName, setRecipientName] = useState('')
  const [fieldValues, setFieldValues] = useState({})
  const [newFieldKey, setNewFieldKey] = useState('')
  const [newFieldLabel, setNewFieldLabel] = useState('')
  const [fieldDefinitions, setFieldDefinitions] = useState([])
  const [entries, setEntries] = useState([])
  const [entriesPage, setEntriesPage] = useState(1)
  const [entryNameFilter, setEntryNameFilter] = useState('')
  const [previewEntryId, setPreviewEntryId] = useState(null)
  const [editingEntryId, setEditingEntryId] = useState(null)
  const [setupSectionOpen, setSetupSectionOpen] = useState(true)
  const [entrySectionOpen, setEntrySectionOpen] = useState(true)
  const [emailSubject, setEmailSubject] = useState('')
  const [emailTemplate, setEmailTemplate] = useState('')
  const [entryError, setEntryError] = useState('')
  const [sendError, setSendError] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [importMessage, setImportMessage] = useState('')
  const [skippedImportEmails, setSkippedImportEmails] = useState([])
  const [skippedInvalidEmails, setSkippedInvalidEmails] = useState([])
  const [projectToDelete, setProjectToDelete] = useState(null)
  const [deleteConfirmName, setDeleteConfirmName] = useState('')
  const [deleteError, setDeleteError] = useState('')
  const [isDeletingProject, setIsDeletingProject] = useState(false)

  const templateLoadedRef = useRef(false)
  const skipTemplateSaveRef = useRef(false)
  const activeDatabaseNameRef = useRef('')
  const importFileInputRef = useRef(null)

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'Projects'),
      (snapshot) => {
        setProjects(snapshot.docs.map((projectDoc) => ({
          id: projectDoc.id,
          ...projectDoc.data(),
        })))
        setProjectsReady(true)
      },
      (error) => {
        setProjects([])
        setProjectsReady(true)
        setProjectError(`Could not load projects: ${error.message}`)
      }
    )

    return unsub
  }, [])

  useEffect(() => {
    if (!activeProjectId) return

    updateDoc(doc(db, 'Projects', activeProjectId), {
      lastAccessedAt: serverTimestamp(),
    }).catch(() => {})
  }, [activeProjectId])

  useEffect(() => {
    if (!activeProjectId) {
      setActiveProject(null)
      return
    }

    templateLoadedRef.current = false
    skipTemplateSaveRef.current = true
    setEmailTemplate('')
    setEmailSubject('')
    setFieldDefinitions([])
    setEntries([])
    setPreviewEntryId(null)
    setEditingEntryId(null)

    const unsub = onSnapshot(doc(db, 'Projects', activeProjectId), (snapshot) => {
      if (!snapshot.exists()) {
        setActiveProject(null)
        navigate('/')
        return
      }

      const data = snapshot.data()
      const project = { id: snapshot.id, ...data }
      activeDatabaseNameRef.current = data.databaseName || ''
      setActiveProject(project)
      setFieldDefinitions(
        (data.fields || []).map((field) => ({
          id: field.key,
          key: field.key,
          label: field.label,
          active: field.active !== false,
        }))
      )
      setEmailTemplate(data.email || '')
      setEmailSubject(data.subject || '')
      templateLoadedRef.current = true
      skipTemplateSaveRef.current = true
    })

    return unsub
  }, [activeProjectId, navigate])

  useEffect(() => {
    if (!activeProject?.databaseName) return

    const entriesRef = collection(db, activeProject.databaseName)

    const unsub = onSnapshot(
      entriesRef,
      (snapshot) => {
        setEntryError('')
        const parsedEntries = snapshot.docs
          .map(parseEntryDoc)
          .filter((entry) => entry.active !== 'N')
        setEntries(parsedEntries)

        if (parsedEntries.length === 0) {
          setPreviewEntryId(null)
          return
        }

        setPreviewEntryId((currentId) => {
          if (currentId && parsedEntries.some((entry) => entry.id === currentId)) {
            return currentId
          }
          return parsedEntries[parsedEntries.length - 1].id
        })
      },
      (error) => {
        setEntryError(`Could not load entries: ${error.message}`)
      }
    )

    return unsub
  }, [activeProject?.databaseName])

  useEffect(() => {
    setEntriesPage(1)
    setEntryNameFilter('')
  }, [activeProject?.databaseName])

  useEffect(() => {
    if (!activeProjectId || !templateLoadedRef.current) return
    if (skipTemplateSaveRef.current) {
      skipTemplateSaveRef.current = false
      return
    }

    const timer = setTimeout(() => {
      updateDoc(doc(db, 'Projects', activeProjectId), {
        email: emailTemplate,
        subject: emailSubject,
      }).catch(() => {})
    }, 800)

    return () => clearTimeout(timer)
  }, [emailTemplate, emailSubject, activeProjectId])

  const builtInFields = [{ key: 'recipientName', label: 'Recipient Name' }]
  const activeFieldDefinitions = fieldDefinitions.filter((field) => field.active)
  const inactiveFieldDefinitions = fieldDefinitions.filter((field) => !field.active)
  const allFieldDefinitions = [...builtInFields, ...activeFieldDefinitions]
  const previewEntry = entries.find((entry) => entry.id === previewEntryId)
  const sortedEntries = sortEntriesByName(entries)
  const filteredEntries = entryNameFilter
    ? sortedEntries.filter((entry) => getEntryNameLetter(entry) === entryNameFilter)
    : sortedEntries
  const entryLetterCounts = sortedEntries.reduce((counts, entry) => {
    const letter = getEntryNameLetter(entry)
    counts[letter] = (counts[letter] || 0) + 1
    return counts
  }, {})
  const totalEntryPages = Math.max(1, Math.ceil(filteredEntries.length / entriesPerPage))
  const safeEntriesPage = Math.min(entriesPage, totalEntryPages)
  const paginatedEntriesStart = (safeEntriesPage - 1) * entriesPerPage
  const paginatedEntries = filteredEntries.slice(
    paginatedEntriesStart,
    paginatedEntriesStart + entriesPerPage
  )
  const paginatedEntriesEnd = Math.min(paginatedEntriesStart + entriesPerPage, filteredEntries.length)

  useEffect(() => {
    if (entriesPage > totalEntryPages) {
      setEntriesPage(totalEntryPages)
    }
  }, [entriesPage, totalEntryPages])

  const goToEntryPage = (entryId) => {
    const entryIndex = filteredEntries.findIndex((item) => item.id === entryId)
    if (entryIndex >= 0) {
      setEntriesPage(Math.floor(entryIndex / entriesPerPage) + 1)
    }
  }

  const handleEntryNameFilter = (letter) => {
    setEntryNameFilter(letter)
    setEntriesPage(1)
  }

  const handleClearEntryNameFilter = () => {
    setEntryNameFilter('')
    setEntriesPage(1)
  }

  const getEntryValues = (entry) => {
    const values = { recipientName: entry.recipientName }
    activeFieldDefinitions.forEach((field) => {
      values[field.key] = entry.fieldValues?.[field.key] || ''
    })
    return values
  }

  const getPreviewValues = () => {
    if (previewEntry) {
      return getEntryValues(previewEntry)
    }

    const values = { recipientName: recipientName.trim() || 'Your Recipient' }
    activeFieldDefinitions.forEach((field) => {
      values[field.key] = fieldValues[field.key]?.trim() || `Your ${field.label}`
    })
    return values
  }

  const previewValues = getPreviewValues()
  const previewSubject = fillTemplate(emailSubject, previewValues)
  const previewText = fillTemplate(emailTemplate, previewValues)

  const saveProjectFields = async (fields) => {
    if (!activeProjectId) return

    await updateDoc(doc(db, 'Projects', activeProjectId), {
      fields: fields.map(({ key, label, active }) => ({
        key,
        label,
        active: active !== false,
      })),
    })
  }

  const handleOpenProject = (project) => {
    navigate(`/${getProjectSlug(project)}`)
    setEditingEntryId(null)
    setEmail('')
    setRecipientName('')
    setFieldValues({})
    setEntryError('')
    setImportMessage('')
    setSkippedImportEmails([])
    setSkippedInvalidEmails([])
  }

  const handleCloseProject = () => {
    navigate('/')
    activeDatabaseNameRef.current = ''
    setActiveProject(null)
    setEditingEntryId(null)
    setEmail('')
    setRecipientName('')
    setFieldValues({})
    setEntries([])
    setPreviewEntryId(null)
    setImportMessage('')
    setSkippedImportEmails([])
    setSkippedInvalidEmails([])
  }

  const handleDeleteProject = (project) => {
    setProjectToDelete(project)
    setDeleteConfirmName('')
    setDeleteError('')
  }

  const handleCancelDeleteProject = () => {
    setProjectToDelete(null)
    setDeleteConfirmName('')
    setDeleteError('')
    setIsDeletingProject(false)
  }

  const handleConfirmDeleteProject = async () => {
    if (!projectToDelete) return

    if (deleteConfirmName !== projectToDelete.name) {
      setDeleteError('Project name does not match.')
      return
    }

    setIsDeletingProject(true)
    setDeleteError('')

    try {
      await updateDoc(doc(db, 'Projects', projectToDelete.id), { active: 'N' })
      handleCancelDeleteProject()

      if (activeProjectId === projectToDelete.id) {
        handleCloseProject()
      }
    } catch {
      setDeleteError('Could not delete project.')
      setIsDeletingProject(false)
    }
  }

  const projectDeleteModal = projectToDelete ? (
    <div className="ProjectDelete">
      <div className="ProjectDelete-Container">
        <h2 className="ProjectDelete-Title">Delete Project</h2>
        <p className="ProjectDelete-Hint">
          This deletes the project and all its entries. Type{' '}
          <strong>{projectToDelete.name}</strong> to confirm.
        </p>

        <label className="ProjectDelete-Label" htmlFor="deleteConfirmName">
          Project Name
        </label>
        <input
          id="deleteConfirmName"
          className="ProjectDelete-Input"
          type="text"
          value={deleteConfirmName}
          onChange={(e) => {
            setDeleteConfirmName(e.target.value)
            setDeleteError('')
          }}
          onPaste={(e) => e.preventDefault()}
          autoComplete="off"
          spellCheck={false}
        />

        {deleteError && <p className="ProjectDelete-Error">{deleteError}</p>}

        <div className="ProjectDelete-Actions">
          <button
            className="ProjectDelete-Button"
            type="button"
            onClick={handleConfirmDeleteProject}
            disabled={deleteConfirmName !== projectToDelete.name || isDeletingProject}
          >
            {isDeletingProject ? 'Deleting...' : 'Delete Project'}
          </button>
          <button
            className="ProjectDelete-Button ProjectDelete-Button--Cancel"
            type="button"
            onClick={handleCancelDeleteProject}
            disabled={isDeletingProject}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  ) : null

  const handleCreateProject = async () => {
    const name = projectName.trim()
    const dbName = databaseName.trim()

    setProjectError('')

    if (!name || !dbName) {
      setProjectError('Project name and database name are required.')
      return
    }

    if (!/^[a-zA-Z0-9]+$/.test(dbName)) {
      setProjectError('Database name can only use letters and numbers.')
      return
    }

    if (projects.some((project) => project.databaseName === dbName)) {
      setProjectError('That database name is already in use.')
      return
    }

    const slug = createUniqueSlug(name, projects)

    setIsSavingProject(true)

    try {
      await addDoc(collection(db, 'Projects'), {
        name,
        slug,
        databaseName: dbName,
        email: '',
        subject: '',
        fields: [],
        active: 'Y',
        dateCreated: serverTimestamp(),
        lastAccessedAt: serverTimestamp(),
      })

      setProjectName('')
      setDatabaseName('')
      navigate(`/${slug}`)
    } catch {
      setProjectError('Could not create project. Check your Firebase setup.')
    } finally {
      setIsSavingProject(false)
    }
  }

  const handleFieldValueChange = (key, value) => {
    setFieldValues((prev) => ({ ...prev, [key]: value }))
  }

  const handleAddFieldDefinition = async () => {
    const key = newFieldKey.trim()
    const label = newFieldLabel.trim()
    if (!key || !label) return
    if (key === 'recipientName') return

    const existingField = fieldDefinitions.find((field) => field.key === key)
    if (existingField?.active) return

    const nextFields = existingField
      ? fieldDefinitions.map((field) =>
          field.key === key ? { ...field, label, active: true } : field
        )
      : [...fieldDefinitions, { id: key, key, label, active: true }]

    setFieldDefinitions(nextFields)
    setNewFieldKey('')
    setNewFieldLabel('')

    try {
      await saveProjectFields(nextFields)
    } catch {
      setEntryError('Could not save field definition.')
    }
  }

  const handleRemoveFieldDefinition = async (id) => {
    const field = fieldDefinitions.find((item) => item.id === id)
    const nextFields = fieldDefinitions.map((item) =>
      item.id === id ? { ...item, active: false } : item
    )
    setFieldDefinitions(nextFields)

    if (field) {
      setFieldValues((prev) => {
        const next = { ...prev }
        delete next[field.key]
        return next
      })
    }

    try {
      await saveProjectFields(nextFields)
    } catch {
      setEntryError('Could not remove field definition.')
    }
  }

  const handleRestoreFieldDefinition = async (id) => {
    const nextFields = fieldDefinitions.map((item) =>
      item.id === id ? { ...item, active: true } : item
    )
    setFieldDefinitions(nextFields)

    try {
      await saveProjectFields(nextFields)
    } catch {
      setEntryError('Could not restore field definition.')
    }
  }

  const handleLoadEntryForEdit = (entry) => {
    setEmail(entry.email)
    setRecipientName(entry.recipientName)
    setFieldValues({ ...(entry.fieldValues || {}) })
    setEditingEntryId(entry.id)
    setPreviewEntryId(entry.id)
    goToEntryPage(entry.id)
    setEntryError('')
  }

  const handleCancelEdit = () => {
    setEditingEntryId(null)
    setEmail('')
    setRecipientName('')
    setFieldValues({})
    setEntryError('')
  }

  const handleDeleteEntry = async () => {
    if (!editingEntryId) return

    const entry = entries.find((item) => item.id === editingEntryId)
    const entryEmail = entry?.email || email.trim()
    const databaseName = activeDatabaseNameRef.current || activeProject?.databaseName
    if (!databaseName) return

    const shouldDelete = window.confirm(
      `Remove ${entryEmail} from this project? The entry will be hidden but kept in the database.`
    )
    if (!shouldDelete) return

    try {
      const entryId = editingEntryId
      await updateDoc(doc(db, databaseName, entryId), { active: 'N' })
      handleCancelEdit()
      if (previewEntryId === entryId) {
        setPreviewEntryId(null)
      }
    } catch {
      setEntryError('Could not remove entry.')
    }
  }

  const buildEntryData = () => {
    const savedFieldValues = {}
    fieldDefinitions.forEach((field) => {
      if (!field.active) return
      savedFieldValues[field.key] = fieldValues[field.key]?.trim() || ''
    })

    return {
      email: email.trim(),
      emailLower: normalizeEmail(email),
      recipientName: recipientName.trim(),
      ...savedFieldValues,
    }
  }

  const handleAdd = async () => {
    if (!email.trim() || !recipientName.trim()) return

    if (!isValidEmail(email)) {
      setEntryError('Enter a valid email address (e.g. name@example.com).')
      return
    }

    const databaseName = activeDatabaseNameRef.current || activeProject?.databaseName
    if (!activeProjectId || !databaseName) {
      setEntryError('Project is still loading. Try again in a moment.')
      return
    }

    setEntryError('')
    const entryData = {
      ...buildEntryData(),
      projectId: activeProjectId,
    }

    try {
      const duplicateEntry = await findDuplicateEmailInDatabase(
        databaseName,
        entryData.email,
        editingEntryId || null
      )
      if (duplicateEntry) {
        setEntryError(`An entry with email ${entryData.email} already exists in this project.`)
        return
      }

      if (editingEntryId) {
        await updateDoc(doc(db, databaseName, editingEntryId), entryData)
        setPreviewEntryId(editingEntryId)
      } else {
        const entryDoc = await addDoc(collection(db, databaseName), {
          ...entryData,
          ...newEntryDefaults,
        })
        setPreviewEntryId(entryDoc.id)
        setEntriesPage(Math.max(1, Math.ceil((sortedEntries.length + 1) / entriesPerPage)))
      }

      setEditingEntryId(null)
      setEmail('')
      setRecipientName('')
      setFieldValues({})
    } catch (error) {
      setEntryError(error.message || 'Could not save entry.')
    }
  }

  const handleSpreadsheetUpload = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    const databaseName = activeDatabaseNameRef.current || activeProject?.databaseName
    if (!activeProjectId || !databaseName) {
      setEntryError('Project is still loading. Try again in a moment.')
      return
    }

    setIsImporting(true)
    setImportMessage('')
    setSkippedImportEmails([])
    setSkippedInvalidEmails([])
    setEntryError('')

    try {
      const buffer = await file.arrayBuffer()
      const workbook = XLSX.read(buffer, { type: 'array' })
      const sheetName = workbook.SheetNames[0]

      if (!sheetName) {
        setEntryError('Spreadsheet has no sheets.')
        return
      }

      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' })

      if (rows.length === 0) {
        setEntryError('Spreadsheet has no data rows.')
        return
      }

      const headers = Object.keys(rows[0])
      const columnMap = buildSpreadsheetColumnMap(headers)
      const mappedKeys = new Set(Object.values(columnMap).map((column) => column.key))

      if (!mappedKeys.has('email') || !mappedKeys.has('recipientName')) {
        setEntryError('Spreadsheet needs Email and Recipient Name columns in the first row.')
        return
      }

      let nextFields = [...fieldDefinitions]
      let fieldsChanged = false

      Object.values(columnMap).forEach(({ key, label }) => {
        if (key === 'email' || key === 'recipientName') return

        const existingField = nextFields.find((field) => field.key === key)
        if (!existingField) {
          nextFields = [...nextFields, { id: key, key, label, active: true }]
          fieldsChanged = true
          return
        }

        if (!existingField.active || existingField.label !== label) {
          nextFields = nextFields.map((field) =>
            field.key === key ? { ...field, label, active: true } : field
          )
          fieldsChanged = true
        }
      })

      if (fieldsChanged) {
        setFieldDefinitions(nextFields)
        await saveProjectFields(nextFields)
      }

      const entriesToImport = []
      let skipped = 0
      const skippedDuplicateEmails = []
      const skippedInvalidEmails = []
      const importEmails = new Set()

      for (const row of rows) {
        const entryData = {
          projectId: activeProjectId,
          ...newEntryDefaults,
          email: '',
          emailLower: '',
          recipientName: '',
        }

        Object.entries(row).forEach(([header, value]) => {
          const mapping = columnMap[header]
          if (!mapping) return

          const cellValue = String(value ?? '').trim()
          if (mapping.key === 'email') {
            entryData.email = cellValue
            entryData.emailLower = normalizeEmail(cellValue)
          } else if (mapping.key === 'recipientName') {
            entryData.recipientName = cellValue
          } else {
            entryData[mapping.key] = cellValue
          }
        })

        if (!entryData.email || !entryData.recipientName) {
          skipped += 1
          continue
        }

        if (!isValidEmail(entryData.email)) {
          skippedInvalidEmails.push(entryData.email)
          continue
        }

        if (importEmails.has(entryData.emailLower)) {
          skippedDuplicateEmails.push(entryData.email)
          continue
        }

        const duplicateEntry = await findDuplicateEmailInDatabase(databaseName, entryData.email)
        if (duplicateEntry) {
          skippedDuplicateEmails.push(entryData.email)
          continue
        }

        importEmails.add(entryData.emailLower)
        entriesToImport.push(entryData)
      }

      if (entriesToImport.length === 0) {
        setSkippedImportEmails(skippedDuplicateEmails)
        setSkippedInvalidEmails(skippedInvalidEmails)
        if (skippedDuplicateEmails.length > 0 || skippedInvalidEmails.length > 0) {
          setImportMessage('No entries imported.')
        } else {
          setEntryError('No valid rows found. Each row needs an email and recipient name.')
        }
        return
      }

      const batchSize = 400
      for (let index = 0; index < entriesToImport.length; index += batchSize) {
        const batch = writeBatch(db)
        const chunk = entriesToImport.slice(index, index + batchSize)

        chunk.forEach((entryData) => {
          const entryRef = doc(collection(db, databaseName))
          batch.set(entryRef, entryData)
        })

        await batch.commit()
      }

      const fieldCount = Object.values(columnMap).filter(
        (column) => column.key !== 'email' && column.key !== 'recipientName'
      ).length

      let importSummary = `Imported ${entriesToImport.length} entr${
        entriesToImport.length === 1 ? 'y' : 'ies'
      }`
      if (fieldCount > 0) {
        importSummary += ` with ${fieldCount} custom field${fieldCount === 1 ? '' : 's'}`
      }

      const skippedNotes = []
      if (skipped > 0) {
        skippedNotes.push(`${skipped} row${skipped === 1 ? '' : 's'} missing email or recipient name`)
      }
      if (skippedInvalidEmails.length > 0) {
        skippedNotes.push(
          `${skippedInvalidEmails.length} row${skippedInvalidEmails.length === 1 ? '' : 's'} with invalid email`
        )
      }
      if (skippedNotes.length > 0) {
        importSummary += `. Skipped ${skippedNotes.join(' and ')}`
      }

      setSkippedImportEmails(skippedDuplicateEmails)
      setSkippedInvalidEmails(skippedInvalidEmails)
      setEntriesPage(Math.max(1, Math.ceil((entries.length + entriesToImport.length) / entriesPerPage)))
      setImportMessage(`${importSummary}.`)
    } catch (error) {
      setEntryError(error.message || 'Could not import spreadsheet.')
    } finally {
      setIsImporting(false)
    }
  }

  const handleExportSpreadsheet = () => {
    if (entries.length === 0) return

    const exportColumns = [
      { key: 'email', label: 'Email' },
      { key: 'recipientName', label: 'Recipient Name' },
      ...activeFieldDefinitions.map((field) => ({ key: field.key, label: field.label })),
    ]

    const rows = entries.map((entry) => {
      const values = getEntryValues(entry)
      const row = {}

      exportColumns.forEach((column) => {
        if (column.key === 'email') {
          row[column.label] = entry.email
        } else {
          row[column.label] = values[column.key] || ''
        }
      })

      return row
    })

    const worksheet = XLSX.utils.json_to_sheet(rows)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Entries')

    const fileName = `${getProjectSlug(activeProject)}-entries.xlsx`
    XLSX.writeFile(workbook, fileName)
  }

  const unsentEntries = entries.filter((entry) => entry.emailSent !== 'Y')

  const handleSendEmails = async () => {
    setSendError('')

    if (unsentEntries.length === 0) {
      setSendError('No unsent entries. All emails are already marked as sent.')
      return
    }

    if (!emailTemplate.trim()) {
      setSendError('Add an email template before sending.')
      return
    }

    const shouldContinue = window.confirm(
      `Send ${unsentEntries.length} email${unsentEntries.length === 1 ? '' : 's'} from your Gmail account? Each will BCC b.jeanne.mills@gmail.com.`
    )
    if (!shouldContinue) return

    const databaseName = activeDatabaseNameRef.current || activeProject?.databaseName
    if (!databaseName) {
      setSendError('Project is still loading. Try again in a moment.')
      return
    }

    setIsSending(true)

    try {
      const sendEmails = httpsCallable(functions, 'sendEmails')
      const { data } = await sendEmails({
        databaseName,
        subject: emailSubject,
        template: emailTemplate,
        entries: unsentEntries.map((entry) => ({
          id: entry.id,
          email: entry.email,
          values: getEntryValues(entry),
        })),
      })

      if (data.failed?.length > 0 && data.sent?.length === 0) {
        setSendError(data.failed[0].error || 'All emails failed to send.')
        return
      }

      if (data.failed?.length > 0) {
        setSendError(
          `Sent ${data.sent.length}, failed ${data.failed.length}: ${data.failed[0].error}`
        )
        return
      }
    } catch (error) {
      setSendError(error.message || 'Could not send emails.')
    } finally {
      setIsSending(false)
    }
  }

  if (!projectsReady) {
    return (
      <div className="ProjectPicker">
        <div className="ProjectPicker-Container">
          <p className="ProjectPicker-Empty">Loading projects...</p>
        </div>
      </div>
    )
  }

  if (!projectSlug) {
    return (
      <div className="ProjectPicker">
        <div className="ProjectPicker-Container">
          <h1 className="ProjectPicker-Title">MES PTA</h1>
          <p className="ProjectPicker-Subtitle">Choose a project or create a new one</p>

          <div className="ProjectPicker-Create">
            <h2 className="ProjectPicker-SectionTitle">New Project</h2>

            <label className="ProjectPicker-Label" htmlFor="projectName">
              Project Name
            </label>
            <input
              id="projectName"
              className="ProjectPicker-Input"
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="Q1 Outreach"
            />

            <label className="ProjectPicker-Label" htmlFor="databaseName">
              Database Name
            </label>
            <input
              id="databaseName"
              className="ProjectPicker-Input"
              type="text"
              value={databaseName}
              onChange={(e) => setDatabaseName(e.target.value.replace(/[^a-zA-Z0-9]/g, ''))}
              placeholder="q1outreach"
            />
            <p className="ProjectPicker-Hint">
              Letters and numbers only. Creates a top-level Firestore collection with this name for entries.
            </p>

            {projectError && <p className="ProjectPicker-Error">{projectError}</p>}

            <button
              className="ProjectPicker-Button"
              type="button"
              onClick={handleCreateProject}
              disabled={isSavingProject}
            >
              {isSavingProject ? 'Creating...' : 'Create Project'}
            </button>
          </div>

          <div className="ProjectPicker-List">
            <h2 className="ProjectPicker-SectionTitle">Projects</h2>

            {activeProjects.length === 0 ? (
              <p className="ProjectPicker-Empty">No projects yet</p>
            ) : (
              <ul className="ProjectPicker-Items">
                {activeProjects.map((project) => (
                  <li key={project.id} className="ProjectPicker-Item">
                    <button
                      className="ProjectPicker-ItemButton"
                      type="button"
                      onClick={() => handleOpenProject(project)}
                    >
                      <span className="ProjectPicker-ItemName">{project.name}</span>
                      <span className="ProjectPicker-ItemDatabase">/{getProjectSlug(project)}</span>
                      {formatProjectDateCreated(project.lastAccessedAt || project.dateCreated) && (
                        <span className="ProjectPicker-ItemDate">
                          {project.lastAccessedAt ? 'Opened' : 'Created'}{' '}
                          {formatProjectDateCreated(project.lastAccessedAt || project.dateCreated)}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    )
  }

  if (!matchedProject) {
    return (
      <div className="ProjectPicker">
        <div className="ProjectPicker-Container">
          <h1 className="ProjectPicker-Title">Project not found</h1>
          <p className="ProjectPicker-Subtitle">
            No project matches <code>/{projectSlug}</code>
          </p>
          <button className="ProjectPicker-Button" type="button" onClick={handleCloseProject}>
            Back to projects
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="EntryForm">
      <div className="EntryForm-Container">
        <div className="EntryForm-Header">
          <div>
            <h1 className="EntryForm-Title">{activeProject?.name || 'MES PTA'}</h1>
            <p className="EntryForm-ProjectMeta">
              Database: <code>{activeProject?.databaseName}</code>
              {formatProjectDateCreated(activeProject?.dateCreated) && (
                <>
                  {' '}
                  · Created {formatProjectDateCreated(activeProject.dateCreated)}
                </>
              )}
            </p>
          </div>
          <div className="EntryForm-HeaderActions">
            <button className="EntryForm-SwitchButton" type="button" onClick={handleCloseProject}>
              Switch Project
            </button>
            <button
              className="EntryForm-DeleteButton"
              type="button"
              onClick={() => handleDeleteProject(activeProject)}
            >
              Delete Project
            </button>
          </div>
        </div>

        <div
          className={`EntryForm-SetupSection${
            setupSectionOpen ? '' : ' EntryForm-SetupSection--Collapsed'
          }`}
        >
          <div className="EntryForm-SetupSectionHeader">
            {!setupSectionOpen && (
              <h3 className="EntryForm-SetupSectionTitle">
                Dynamic Fields & Excel Functionality
                {activeFieldDefinitions.length > 0 && (
                  <span className="EntryForm-SetupSectionCount">
                    {' '}
                    ({activeFieldDefinitions.length} field
                    {activeFieldDefinitions.length === 1 ? '' : 's'})
                  </span>
                )}
              </h3>
            )}
            <button
              className="EntryForm-SetupSectionToggle"
              type="button"
              onClick={() => setSetupSectionOpen((open) => !open)}
            >
              {setupSectionOpen ? 'Minimize' : 'Expand'}
            </button>
          </div>

          {setupSectionOpen && (
            <div className="EntryForm-SetupRow">
              <div className="EntryForm-FieldSetup EntryForm-SetupRow-Fields">
                <h3 className="EntryForm-FieldSetupTitle">
                  Dynamic Fields
                  {activeFieldDefinitions.length > 0 && (
                    <span className="EntryForm-FieldSetupCount"> ({activeFieldDefinitions.length})</span>
                  )}
                </h3>

                <p className="EntryForm-FieldSetupHint">
                  Field keys are saved to this project and stored on documents in the{' '}
                  <code>{activeProject?.databaseName}</code> collection.
                </p>

                {activeFieldDefinitions.length > 0 && (
                  <ul className="EntryForm-FieldList">
                    {activeFieldDefinitions.map((field) => (
                      <li key={field.id} className="EntryForm-FieldListItem">
                        <span className="EntryForm-FieldListLabel">{field.label}</span>
                        <code className="EntryForm-FieldListCode">{toPlaceholder(field.key)}</code>
                        <button
                          className="EntryForm-FieldRemove"
                          type="button"
                          onClick={() => handleRemoveFieldDefinition(field.id)}
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="EntryForm-FieldAdd">
                  <input
                    className="EntryForm-Input EntryForm-FieldAddInput"
                    type="text"
                    value={newFieldLabel}
                    onChange={(e) => setNewFieldLabel(e.target.value)}
                    placeholder="In App Label (e.g. Contact Name)"
                  />
                  <input
                    className="EntryForm-Input EntryForm-FieldAddInput"
                    type="text"
                    value={newFieldKey}
                    onChange={(e) => setNewFieldKey(e.target.value.replace(/[^a-zA-Z0-9]/g, ''))}
                    placeholder="Database Item Name (e.g. contactName, letters and numbers only)"
                  />
                  <button
                    className="EntryForm-Button EntryForm-FieldAddButton"
                    type="button"
                    onClick={handleAddFieldDefinition}
                  >
                    Add Field
                  </button>
                </div>

                {inactiveFieldDefinitions.length > 0 && (
                  <div className="EntryForm-FieldInactive">
                    <h4 className="EntryForm-FieldInactiveTitle">Removed Fields</h4>
                    <p className="EntryForm-FieldInactiveHint">
                      These fields are hidden but still saved. Add one back anytime.
                    </p>
                    <ul className="EntryForm-FieldList">
                      {inactiveFieldDefinitions.map((field) => (
                        <li key={field.id} className="EntryForm-FieldListItem">
                          <span className="EntryForm-FieldListLabel">{field.label}</span>
                          <code className="EntryForm-FieldListCode">{toPlaceholder(field.key)}</code>
                          <button
                            className="EntryForm-FieldRestore"
                            type="button"
                            onClick={() => handleRestoreFieldDefinition(field.id)}
                          >
                            Add Back
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div className="EntryForm-SetupRow-Import">
              <div className="EntryForm-Import">
                <h3 className="EntryForm-ImportTitle">Import Spreadsheet</h3>

                <p className="EntryForm-ImportHint">
                  Upload .xlsx, .xls, or .csv. Row 1 should be column headers — at minimum{' '}
                  <strong>Email</strong> and <strong>Recipient Name</strong>. Other columns become
                  custom fields. Google Sheets: File → Download → Excel or CSV.
                </p>

                <input
                  ref={importFileInputRef}
                  className="EntryForm-ImportInput"
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleSpreadsheetUpload}
                  disabled={isImporting}
                />

                <button
                  className="EntryForm-Button EntryForm-ImportButton"
                  type="button"
                  onClick={() => importFileInputRef.current?.click()}
                  disabled={isImporting}
                >
                  {isImporting ? 'Importing...' : 'Choose File'}
                </button>

                {importMessage && <p className="EntryForm-ImportSuccess">{importMessage}</p>}

                {skippedImportEmails.length > 0 && (
                  <div className="EntryForm-ImportSkipped">
                    <p className="EntryForm-ImportSkippedTitle">
                      Here are the emails skipped because they already existed:
                    </p>
                    <ul className="EntryForm-ImportSkippedList">
                      {skippedImportEmails.map((skippedEmail, index) => (
                        <li key={`${skippedEmail}-${index}`} className="EntryForm-ImportSkippedItem">
                          {skippedEmail}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {skippedInvalidEmails.length > 0 && (
                  <div className="EntryForm-ImportSkipped">
                    <p className="EntryForm-ImportSkippedTitle">
                      Here are the emails skipped because the format was invalid:
                    </p>
                    <ul className="EntryForm-ImportSkippedList">
                      {skippedInvalidEmails.map((invalidEmail, index) => (
                        <li key={`${invalidEmail}-${index}`} className="EntryForm-ImportSkippedItem">
                          {invalidEmail}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div className="EntryForm-Export">
                <h3 className="EntryForm-ExportTitle">Export Spreadsheet</h3>

                <p className="EntryForm-ExportHint">
                  Download all active entries as .xlsx. Columns match the import format —{' '}
                  <strong>Email</strong>, <strong>Recipient Name</strong>, plus any custom fields.
                </p>

                <button
                  className="EntryForm-Button EntryForm-ExportButton"
                  type="button"
                  onClick={handleExportSpreadsheet}
                  disabled={entries.length === 0}
                >
                  Export to Excel
                </button>
              </div>
              </div>
            </div>
          )}
        </div>

        {/* <div className="EmailTemplate">
          <div className="EmailTemplate-Container">
            <h2 className="EmailTemplate-Title">Email Template</h2>
            <p className="EmailTemplate-Hint">
              Saved to this project in Firebase. Use placeholders like{' '}
              {allFieldDefinitions.map((field, index) => (
                <span key={field.key}>
                  {index > 0 && ', '}
                  <code>{toPlaceholder(field.key)}</code>
                </span>
              ))}{' '}
              in the subject and body.
            </p>

            <label className="EmailTemplate-Label" htmlFor="emailSubject">
              Subject
            </label>
            <input
              id="emailSubject"
              className="EmailTemplate-Input"
              type="text"
              value={emailSubject}
              onChange={(e) => setEmailSubject(e.target.value)}
              placeholder={`Follow up with ${toPlaceholder('recipientName')}`}
            />

            <label className="EmailTemplate-Label" htmlFor="emailTemplate">
              Template
            </label>
            <textarea
              id="emailTemplate"
              className="EmailTemplate-Textarea"
              value={emailTemplate}
              onChange={(e) => setEmailTemplate(e.target.value)}
              placeholder={`Hi ${toPlaceholder('recipientName')},\n\nWe wanted to reach out about ${toPlaceholder('contactName')}...`}
              rows={6}
            />

            <h3 className="EmailTemplate-PreviewTitle">Preview</h3>
            <p className="EmailTemplate-PreviewHint">
              {previewEntry ? (
                <>
                  Previewing entry for <strong>{previewEntry.email}</strong> ({previewEntry.recipientName})
                </>
              ) : (
                <>Add an entry below to preview with real values</>
              )}
            </p>
            <div className="EmailTemplate-Preview">
              {emailSubject.trim() || emailTemplate.trim() ? (
                <>
                  {emailSubject.trim() && (
                    <p className="EmailTemplate-PreviewSubject">
                      <span className="EmailTemplate-PreviewSubjectLabel">Subject:</span>{' '}
                      {previewSubject}
                    </p>
                  )}
                  {emailTemplate.trim() && (
                    <pre className="EmailTemplate-PreviewText">{previewText}</pre>
                  )}
                </>
              ) : (
                <p className="EmailTemplate-Empty">Write a subject or template above to see a preview</p>
              )}
            </div>

            <div className="EmailTemplate-Send">
              <button
                className="EmailTemplate-SendButton"
                type="button"
                onClick={handleSendEmails}
                disabled={unsentEntries.length === 0 || isSending}
              >
                {isSending ? 'Sending...' : 'Send Emails'}
              </button>
              {sendError && <p className="EmailTemplate-SendError">{sendError}</p>}
            </div>
          </div>
        </div> */}

        <div className="EntryForm-EntrySection">
          <div className="EntryForm-EntrySectionHeader">
            <h3 className="EntryForm-EntrySectionTitle">
              Add Entry & Entries
              {entries.length > 0 && (
                <span className="EntryForm-EntrySectionCount"> ({entries.length})</span>
              )}
            </h3>
            <button
              className="EntryForm-EntrySectionToggle"
              type="button"
              onClick={() => setEntrySectionOpen((open) => !open)}
            >
              {entrySectionOpen ? 'Minimize' : 'Expand'}
            </button>
          </div>

          {entrySectionOpen && (
            <div className="EntryForm-Row">
              <div className="EntryForm-Left">
                <h2 className="EntryForm-SectionTitle">Add Entry</h2>

            <label className="EntryForm-Label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              className="EntryForm-Input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter email"
            />

            <label className="EntryForm-Label" htmlFor="recipientName">
              Recipient Name
            </label>
            <input
              id="recipientName"
              className="EntryForm-Input"
              type="text"
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              placeholder="Enter recipient name"
            />

            {activeFieldDefinitions.length > 0 && (
              <div className="EntryForm-Fields">
                {activeFieldDefinitions.map((field) => (
                  <div key={field.id} className="EntryForm-FieldRow">
                    <label className="EntryForm-Label" htmlFor={`field-${field.key}`}>
                      {field.label}
                    </label>
                    <input
                      id={`field-${field.key}`}
                      className="EntryForm-Input"
                      type="text"
                      value={fieldValues[field.key] || ''}
                      onChange={(e) => handleFieldValueChange(field.key, e.target.value)}
                      placeholder={`Enter ${field.label.toLowerCase()}`}
                    />
                  </div>
                ))}
              </div>
            )}

            <div className="EntryForm-Actions">
              <button className="EntryForm-Button" type="button" onClick={handleAdd}>
                {editingEntryId ? 'Save' : 'Add'}
              </button>
              {editingEntryId && (
                <>
                  <button
                    className="EntryForm-Button EntryForm-Button--Delete"
                    type="button"
                    onClick={handleDeleteEntry}
                  >
                    Delete
                  </button>
                  <button
                    className="EntryForm-Button EntryForm-Button--Cancel"
                    type="button"
                    onClick={handleCancelEdit}
                  >
                    Cancel
                  </button>
                </>
              )}
            </div>

            {editingEntryId && (
              <p className="EntryForm-EditHint">Editing entry — make changes and click Save</p>
            )}
            {entryError && <p className="EntryForm-Error">{entryError}</p>}
          </div>

          <div className="EntryForm-Right">
            <h2 className="EntryForm-ListTitle">
              Entries
              {entryNameFilter && (
                <span className="EntryForm-ListTitle-Filter">
                  {' '}
                  · {entryNameFilter === '#' ? 'Other' : entryNameFilter}
                </span>
              )}
            </h2>
            <p className="EntryForm-ListHint">
              Sorted A–Z by name. Click to preview. Double-click to edit.
            </p>

            {entries.length === 0 ? (
              <div className="EntryForm-List-Area">
                <p className="EntryForm-Empty EntryForm-List-Empty">No entries yet</p>
              </div>
            ) : (
              <>
                <div className="EntryForm-ListFilter">
                  <div className="EntryForm-ListFilter-Alphabet">
                    {entryAlphabetLetters.map((letter) => (
                      <button
                        key={letter}
                        className={`EntryForm-ListFilter-Letter${
                          entryNameFilter === letter ? ' EntryForm-ListFilter-Letter--Active' : ''
                        }`}
                        type="button"
                        onClick={() => handleEntryNameFilter(letter)}
                        disabled={!entryLetterCounts[letter]}
                        title={
                          entryLetterCounts[letter]
                            ? `${entryLetterCounts[letter]} name${entryLetterCounts[letter] === 1 ? '' : 's'}`
                            : 'No names'
                        }
                      >
                        {letter}
                      </button>
                    ))}
                    <button
                      className={`EntryForm-ListFilter-Letter EntryForm-ListFilter-Letter--Other${
                        entryNameFilter === '#' ? ' EntryForm-ListFilter-Letter--Active' : ''
                      }`}
                      type="button"
                      onClick={() => handleEntryNameFilter('#')}
                      disabled={!entryLetterCounts['#']}
                      title={
                        entryLetterCounts['#']
                          ? `${entryLetterCounts['#']} name${entryLetterCounts['#'] === 1 ? '' : 's'}`
                          : 'No names'
                      }
                    >
                      #
                    </button>
                  </div>
                  {entryNameFilter && (
                    <button
                      className="EntryForm-ListFilter-Clear"
                      type="button"
                      onClick={handleClearEntryNameFilter}
                    >
                      Clear
                    </button>
                  )}
                </div>

                {filteredEntries.length === 0 ? (
                  <div className="EntryForm-List-Area">
                    <p className="EntryForm-Empty EntryForm-List-Empty">No entries match this filter.</p>
                  </div>
                ) : (
                  <>
                <div className="EntryForm-List-Area">
                <ul className="EntryForm-List EntryForm-List--Scroll">
                  {paginatedEntries.map((entry) => (
                    <li
                      key={entry.id}
                      className={`EntryForm-ListItem${
                        entry.id === previewEntryId ? ' EntryForm-ListItem--Active' : ''
                      }${entry.id === editingEntryId ? ' EntryForm-ListItem--Editing' : ''}`}
                    >
                      <button
                        className="EntryForm-ListButton"
                        type="button"
                        onClick={() => setPreviewEntryId(entry.id)}
                        onDoubleClick={() => handleLoadEntryForEdit(entry)}
                      >
                        <span className="EntryForm-ListEmail">{entry.email}</span>
                        <span className="EntryForm-ListRecipientName">{entry.recipientName}</span>
                        <span
                          className={`EntryForm-ListStatus${
                            entry.emailSent === 'Y' ? ' EntryForm-ListStatus--Sent' : ''
                          }`}
                        >
                          {entry.emailSent === 'Y' ? 'Sent' : 'Not sent'}
                        </span>
                        {activeFieldDefinitions.map((field) => {
                          const value = entry.fieldValues?.[field.key]
                          if (!value) return null
                          return (
                            <span key={field.id} className="EntryForm-ListField">
                              {field.label}: {value}
                            </span>
                          )
                        })}
                      </button>
                    </li>
                  ))}
                </ul>
                </div>

                {totalEntryPages > 1 && (
                  <div className="EntryForm-ListPagination">
                    <p className="EntryForm-ListPagination-Info">
                      Showing {paginatedEntriesStart + 1}–{paginatedEntriesEnd} of{' '}
                      {filteredEntries.length}
                      {entryNameFilter ? ` (${entries.length} total)` : ''}
                    </p>
                    <div className="EntryForm-ListPagination-Controls">
                      <button
                        className="EntryForm-ListPagination-Button"
                        type="button"
                        onClick={() => setEntriesPage(1)}
                        disabled={safeEntriesPage <= 1}
                      >
                        First
                      </button>
                      <button
                        className="EntryForm-ListPagination-Button"
                        type="button"
                        onClick={() => setEntriesPage((page) => Math.max(1, page - 1))}
                        disabled={safeEntriesPage <= 1}
                      >
                        Previous
                      </button>
                      <span className="EntryForm-ListPagination-Page">
                        Page {safeEntriesPage} of {totalEntryPages}
                      </span>
                      <button
                        className="EntryForm-ListPagination-Button"
                        type="button"
                        onClick={() => setEntriesPage((page) => Math.min(totalEntryPages, page + 1))}
                        disabled={safeEntriesPage >= totalEntryPages}
                      >
                        Next
                      </button>
                      <button
                        className="EntryForm-ListPagination-Button"
                        type="button"
                        onClick={() => setEntriesPage(totalEntryPages)}
                        disabled={safeEntriesPage >= totalEntryPages}
                      >
                        Last
                      </button>
                    </div>
                  </div>
                )}
                  </>
                )}
              </>
            )}
          </div>
            </div>
          )}
        </div>       <div className="EmailTemplate">
          <div className="EmailTemplate-Container">
            <h2 className="EmailTemplate-Title">Email Template</h2>
            <p className="EmailTemplate-Hint">
              Saved to this project in Firebase. Use placeholders like{' '}
              {allFieldDefinitions.map((field, index) => (
                <span key={field.key}>
                  {index > 0 && ', '}
                  <code>{toPlaceholder(field.key)}</code>
                </span>
              ))}{' '}
              in the subject and body to use dynamic values.
            </p>

            <label className="EmailTemplate-Label" htmlFor="emailSubject">
              Subject
            </label>
            <input
              id="emailSubject"
              className="EmailTemplate-Input"
              type="text"
              value={emailSubject}
              onChange={(e) => setEmailSubject(e.target.value)}
              placeholder={`Follow up with ${toPlaceholder('recipientName')}`}
            />

            <label className="EmailTemplate-Label" htmlFor="emailTemplate">
              Template
            </label>
            <textarea
              id="emailTemplate"
              className="EmailTemplate-Textarea"
              value={emailTemplate}
              onChange={(e) => setEmailTemplate(e.target.value)}
              placeholder={`Hi ${toPlaceholder('recipientName')},\n\nWe wanted to reach out about ${toPlaceholder('contactName')}...`}
              rows={6}
            />

            <h3 className="EmailTemplate-PreviewTitle">Preview</h3>
            <p className="EmailTemplate-PreviewHint">
              {previewEntry ? (
                <>
                  Previewing entry for <strong>{previewEntry.email}</strong> ({previewEntry.recipientName})
                </>
              ) : (
                <>Add an entry below to preview with real values</>
              )}
            </p>
            <div className="EmailTemplate-Preview">
              {emailSubject.trim() || emailTemplate.trim() ? (
                <>
                  {emailSubject.trim() && (
                    <p className="EmailTemplate-PreviewSubject">
                      <span className="EmailTemplate-PreviewSubjectLabel">Subject:</span>{' '}
                      {previewSubject}
                    </p>
                  )}
                  {emailTemplate.trim() && (
                    <pre className="EmailTemplate-PreviewText">{previewText}</pre>
                  )}
                </>
              ) : (
                <p className="EmailTemplate-Empty">Write a subject or template above to see a preview</p>
              )}
            </div>

            <div className="EmailTemplate-Send">
              <button
                className="EmailTemplate-SendButton"
                type="button"
                onClick={handleSendEmails}
                disabled={unsentEntries.length === 0 || isSending}
              >
                {isSending ? 'Sending...' : 'Send Emails'}
              </button>
              {sendError && <p className="EmailTemplate-SendError">{sendError}</p>}
            </div>
          </div>
        </div>
      </div>
      {projectDeleteModal}
    </div>
  )
}

export default App
