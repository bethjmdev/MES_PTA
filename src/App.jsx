import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  updateDoc,
  writeBatch,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import * as XLSX from 'xlsx'
import { db, functions } from './firebase/firebase'
import './App.css'

const builtInEntryKeys = ['email', 'companyName', 'projectId', 'email_sent']

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
    companyName: data.companyName || '',
    emailSent: data.email_sent || 'N',
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
  if (['companyname', 'company', 'organization', 'organisation'].includes(normalized)) {
    return 'companyName'
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

function App() {
  const navigate = useNavigate()
  const { projectSlug } = useParams()
  const [projects, setProjects] = useState([])
  const [projectsReady, setProjectsReady] = useState(false)
  const matchedProject = projects.find((project) => getProjectSlug(project) === projectSlug)
  const activeProjectId = matchedProject?.id || ''
  const [activeProject, setActiveProject] = useState(null)
  const [projectName, setProjectName] = useState('')
  const [databaseName, setDatabaseName] = useState('')
  const [projectError, setProjectError] = useState('')
  const [isSavingProject, setIsSavingProject] = useState(false)

  const [email, setEmail] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [fieldValues, setFieldValues] = useState({})
  const [newFieldKey, setNewFieldKey] = useState('')
  const [newFieldLabel, setNewFieldLabel] = useState('')
  const [fieldDefinitions, setFieldDefinitions] = useState([])
  const [entries, setEntries] = useState([])
  const [previewEntryId, setPreviewEntryId] = useState(null)
  const [editingEntryId, setEditingEntryId] = useState(null)
  const [fieldSetupOpen, setFieldSetupOpen] = useState(true)
  const [importOpen, setImportOpen] = useState(true)
  const [emailSubject, setEmailSubject] = useState('')
  const [emailTemplate, setEmailTemplate] = useState('')
  const [entryError, setEntryError] = useState('')
  const [sendError, setSendError] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [importMessage, setImportMessage] = useState('')

  const templateLoadedRef = useRef(false)
  const skipTemplateSaveRef = useRef(false)
  const activeDatabaseNameRef = useRef('')
  const importFileInputRef = useRef(null)

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'Projects'), (snapshot) => {
      setProjects(snapshot.docs.map((projectDoc) => ({
        id: projectDoc.id,
        ...projectDoc.data(),
      })))
      setProjectsReady(true)
    })

    return unsub
  }, [])

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
        const parsedEntries = snapshot.docs.map(parseEntryDoc)
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

  const builtInFields = [{ key: 'companyName', label: 'Company Name' }]
  const activeFieldDefinitions = fieldDefinitions.filter((field) => field.active)
  const inactiveFieldDefinitions = fieldDefinitions.filter((field) => !field.active)
  const allFieldDefinitions = [...builtInFields, ...activeFieldDefinitions]
  const previewEntry = entries.find((entry) => entry.id === previewEntryId)

  const getEntryValues = (entry) => {
    const values = { companyName: entry.companyName }
    activeFieldDefinitions.forEach((field) => {
      values[field.key] = entry.fieldValues?.[field.key] || ''
    })
    return values
  }

  const getPreviewValues = () => {
    if (previewEntry) {
      return getEntryValues(previewEntry)
    }

    const values = { companyName: companyName.trim() || 'Your Company' }
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
    setCompanyName('')
    setFieldValues({})
    setEntryError('')
    setImportMessage('')
  }

  const handleCloseProject = () => {
    navigate('/')
    activeDatabaseNameRef.current = ''
    setActiveProject(null)
    setEditingEntryId(null)
    setEmail('')
    setCompanyName('')
    setFieldValues({})
    setEntries([])
    setPreviewEntryId(null)
    setImportMessage('')
  }

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
    if (key === 'companyName') return

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
    setCompanyName(entry.companyName)
    setFieldValues({ ...(entry.fieldValues || {}) })
    setEditingEntryId(entry.id)
    setPreviewEntryId(entry.id)
    setEntryError('')
  }

  const handleCancelEdit = () => {
    setEditingEntryId(null)
    setEmail('')
    setCompanyName('')
    setFieldValues({})
    setEntryError('')
  }

  const buildEntryData = () => {
    const savedFieldValues = {}
    fieldDefinitions.forEach((field) => {
      if (!field.active) return
      savedFieldValues[field.key] = fieldValues[field.key]?.trim() || ''
    })

    return {
      email: email.trim(),
      companyName: companyName.trim(),
      ...savedFieldValues,
    }
  }

  const handleAdd = async () => {
    if (!email.trim() || !companyName.trim()) return

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
      if (editingEntryId) {
        await updateDoc(doc(db, databaseName, editingEntryId), entryData)
        setPreviewEntryId(editingEntryId)
      } else {
        const entryDoc = await addDoc(collection(db, databaseName), {
          ...entryData,
          email_sent: 'N',
        })
        setPreviewEntryId(entryDoc.id)
      }

      setEditingEntryId(null)
      setEmail('')
      setCompanyName('')
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

      if (!mappedKeys.has('email') || !mappedKeys.has('companyName')) {
        setEntryError('Spreadsheet needs Email and Company Name columns in the first row.')
        return
      }

      let nextFields = [...fieldDefinitions]
      let fieldsChanged = false

      Object.values(columnMap).forEach(({ key, label }) => {
        if (key === 'email' || key === 'companyName') return

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

      rows.forEach((row) => {
        const entryData = {
          projectId: activeProjectId,
          email_sent: 'N',
          email: '',
          companyName: '',
        }

        Object.entries(row).forEach(([header, value]) => {
          const mapping = columnMap[header]
          if (!mapping) return

          const cellValue = String(value ?? '').trim()
          if (mapping.key === 'email') {
            entryData.email = cellValue
          } else if (mapping.key === 'companyName') {
            entryData.companyName = cellValue
          } else {
            entryData[mapping.key] = cellValue
          }
        })

        if (!entryData.email || !entryData.companyName) {
          skipped += 1
          return
        }

        entriesToImport.push(entryData)
      })

      if (entriesToImport.length === 0) {
        setEntryError('No valid rows found. Each row needs an email and company name.')
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
        (column) => column.key !== 'email' && column.key !== 'companyName'
      ).length

      setImportMessage(
        `Imported ${entriesToImport.length} entr${entriesToImport.length === 1 ? 'y' : 'ies'}${
          fieldCount > 0 ? ` with ${fieldCount} custom field${fieldCount === 1 ? '' : 's'}` : ''
        }${skipped > 0 ? `. Skipped ${skipped} row${skipped === 1 ? '' : 's'} missing email or company name.` : '.'}`
      )
    } catch (error) {
      setEntryError(error.message || 'Could not import spreadsheet.')
    } finally {
      setIsImporting(false)
    }
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

            {projects.length === 0 ? (
              <p className="ProjectPicker-Empty">No projects yet</p>
            ) : (
              <ul className="ProjectPicker-Items">
                {projects.map((project) => (
                  <li key={project.id} className="ProjectPicker-Item">
                    <button
                      className="ProjectPicker-ItemButton"
                      type="button"
                      onClick={() => handleOpenProject(project)}
                    >
                      <span className="ProjectPicker-ItemName">{project.name}</span>
                      <span className="ProjectPicker-ItemDatabase">/{getProjectSlug(project)}</span>
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

  if (!projectsReady) {
    return (
      <div className="ProjectPicker">
        <div className="ProjectPicker-Container">
          <p className="ProjectPicker-Empty">Loading project...</p>
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
            </p>
          </div>
          <button className="EntryForm-SwitchButton" type="button" onClick={handleCloseProject}>
            Switch Project
          </button>
        </div>

        <div className="EntryForm-SetupRow">
          <div className="EntryForm-FieldSetup EntryForm-SetupRow-Fields">
            <div className="EntryForm-FieldSetupHeader">
              <h3 className="EntryForm-FieldSetupTitle">
                Dynamic Fields
                {activeFieldDefinitions.length > 0 && (
                  <span className="EntryForm-FieldSetupCount"> ({activeFieldDefinitions.length})</span>
                )}
              </h3>
              <button
                className="EntryForm-FieldSetupToggle"
                type="button"
                onClick={() => setFieldSetupOpen((open) => !open)}
              >
                {fieldSetupOpen ? 'Minimize' : 'Expand'}
              </button>
            </div>

            {fieldSetupOpen && (
              <>
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
              </>
            )}
          </div>

          <div className="EntryForm-Import EntryForm-SetupRow-Import">
            <div className="EntryForm-ImportHeader">
              <h3 className="EntryForm-ImportTitle">Import Spreadsheet</h3>
              <button
                className="EntryForm-ImportToggle"
                type="button"
                onClick={() => setImportOpen((open) => !open)}
              >
                {importOpen ? 'Minimize' : 'Expand'}
              </button>
            </div>

            {importOpen && (
              <>
                <p className="EntryForm-ImportHint">
                  Upload .xlsx, .xls, or .csv. Row 1 should be column headers — at minimum{' '}
                  <strong>Email</strong> and <strong>Company Name</strong>. Other columns become
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
              </>
            )}
          </div>
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
              placeholder={`Follow up with ${toPlaceholder('companyName')}`}
            />

            <label className="EmailTemplate-Label" htmlFor="emailTemplate">
              Template
            </label>
            <textarea
              id="emailTemplate"
              className="EmailTemplate-Textarea"
              value={emailTemplate}
              onChange={(e) => setEmailTemplate(e.target.value)}
              placeholder={`Hi ${toPlaceholder('companyName')},\n\nWe wanted to reach out about ${toPlaceholder('contactName')}...`}
              rows={6}
            />

            <h3 className="EmailTemplate-PreviewTitle">Preview</h3>
            <p className="EmailTemplate-PreviewHint">
              {previewEntry ? (
                <>
                  Previewing entry for <strong>{previewEntry.email}</strong> ({previewEntry.companyName})
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

            <label className="EntryForm-Label" htmlFor="companyName">
              Company Name
            </label>
            <input
              id="companyName"
              className="EntryForm-Input"
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Enter company name"
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
                <button
                  className="EntryForm-Button EntryForm-Button--Cancel"
                  type="button"
                  onClick={handleCancelEdit}
                >
                  Cancel
                </button>
              )}
            </div>

            {editingEntryId && (
              <p className="EntryForm-EditHint">Editing entry — make changes and click Save</p>
            )}
            {entryError && <p className="EntryForm-Error">{entryError}</p>}
          </div>

          <div className="EntryForm-Right">
            <h2 className="EntryForm-ListTitle">Entries</h2>
            <p className="EntryForm-ListHint">Click to preview. Double-click to edit.</p>

            {entries.length === 0 ? (
              <p className="EntryForm-Empty">No entries yet</p>
            ) : (
              <ul className="EntryForm-List">
                {entries.map((entry) => (
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
                      <span className="EntryForm-ListCompany">{entry.companyName}</span>
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
            )}
          </div>
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
              placeholder={`Follow up with ${toPlaceholder('companyName')}`}
            />

            <label className="EmailTemplate-Label" htmlFor="emailTemplate">
              Template
            </label>
            <textarea
              id="emailTemplate"
              className="EmailTemplate-Textarea"
              value={emailTemplate}
              onChange={(e) => setEmailTemplate(e.target.value)}
              placeholder={`Hi ${toPlaceholder('companyName')},\n\nWe wanted to reach out about ${toPlaceholder('contactName')}...`}
              rows={6}
            />

            <h3 className="EmailTemplate-PreviewTitle">Preview</h3>
            <p className="EmailTemplate-PreviewHint">
              {previewEntry ? (
                <>
                  Previewing entry for <strong>{previewEntry.email}</strong> ({previewEntry.companyName})
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
    </div>
  )
}

export default App
