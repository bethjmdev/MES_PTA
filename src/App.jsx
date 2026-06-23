import { useEffect, useRef, useState } from 'react'
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  updateDoc,
} from 'firebase/firestore'
import { db } from './firebase/firebase'
import './App.css'

const activeProjectStorageKey = 'mesPtaActiveProjectId'
const builtInEntryKeys = ['email', 'companyName', 'projectId']

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
    fieldValues,
  }
}

function App() {
  const [projects, setProjects] = useState([])
  const [activeProjectId, setActiveProjectId] = useState(
    () => localStorage.getItem(activeProjectStorageKey) || ''
  )
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
  const [emailSubject, setEmailSubject] = useState('')
  const [emailTemplate, setEmailTemplate] = useState('')
  const [entryError, setEntryError] = useState('')

  const templateLoadedRef = useRef(false)
  const skipTemplateSaveRef = useRef(false)
  const activeDatabaseNameRef = useRef('')

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'Projects'), (snapshot) => {
      setProjects(snapshot.docs.map((projectDoc) => ({
        id: projectDoc.id,
        ...projectDoc.data(),
      })))
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
        setActiveProjectId('')
        localStorage.removeItem(activeProjectStorageKey)
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
        }))
      )
      setEmailTemplate(data.email || '')
      setEmailSubject(data.subject || '')
      templateLoadedRef.current = true
      skipTemplateSaveRef.current = true
    })

    return unsub
  }, [activeProjectId])

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
  const allFieldDefinitions = [...builtInFields, ...fieldDefinitions]
  const previewEntry = entries.find((entry) => entry.id === previewEntryId)

  const getPreviewValues = () => {
    if (previewEntry) {
      const values = { companyName: previewEntry.companyName }
      fieldDefinitions.forEach((field) => {
        values[field.key] = previewEntry.fieldValues?.[field.key] || ''
      })
      return values
    }

    const values = { companyName: companyName.trim() || 'Your Company' }
    fieldDefinitions.forEach((field) => {
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
      fields: fields.map(({ key, label }) => ({ key, label })),
    })
  }

  const handleOpenProject = (projectId) => {
    setActiveProjectId(projectId)
    localStorage.setItem(activeProjectStorageKey, projectId)
    setEditingEntryId(null)
    setEmail('')
    setCompanyName('')
    setFieldValues({})
    setEntryError('')
  }

  const handleCloseProject = () => {
    setActiveProjectId('')
    localStorage.removeItem(activeProjectStorageKey)
    activeDatabaseNameRef.current = ''
    setActiveProject(null)
    setEditingEntryId(null)
    setEmail('')
    setCompanyName('')
    setFieldValues({})
    setEntries([])
    setPreviewEntryId(null)
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

    setIsSavingProject(true)

    try {
      const projectDoc = await addDoc(collection(db, 'Projects'), {
        name,
        databaseName: dbName,
        email: '',
        subject: '',
        fields: [],
      })

      setProjectName('')
      setDatabaseName('')
      handleOpenProject(projectDoc.id)
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
    if (allFieldDefinitions.some((field) => field.key === key)) return

    const nextFields = [...fieldDefinitions, { id: key, key, label }]
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
    const nextFields = fieldDefinitions.filter((item) => item.id !== id)
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
        const entryDoc = await addDoc(collection(db, databaseName), entryData)
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

  if (!activeProjectId) {
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
                      onClick={() => handleOpenProject(project.id)}
                    >
                      <span className="ProjectPicker-ItemName">{project.name}</span>
                      <span className="ProjectPicker-ItemDatabase">{project.databaseName}</span>
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

        <div className="EntryForm-Row">
          <div className="EntryForm-Left">
            <div className="EntryForm-FieldSetup">
              <div className="EntryForm-FieldSetupHeader">
                <h3 className="EntryForm-FieldSetupTitle">
                  Dynamic Fields
                  {fieldDefinitions.length > 0 && (
                    <span className="EntryForm-FieldSetupCount"> ({fieldDefinitions.length})</span>
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

                  {fieldDefinitions.length > 0 && (
                    <ul className="EntryForm-FieldList">
                      {fieldDefinitions.map((field) => (
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
                      placeholder="Label (e.g. Contact Name)"
                    />
                    <input
                      className="EntryForm-Input EntryForm-FieldAddInput"
                      type="text"
                      value={newFieldKey}
                      onChange={(e) => setNewFieldKey(e.target.value.replace(/[^a-zA-Z0-9]/g, ''))}
                      placeholder="Key (e.g. contactName, letters and numbers only)"
                    />
                    <button
                      className="EntryForm-Button EntryForm-FieldAddButton"
                      type="button"
                      onClick={handleAddFieldDefinition}
                    >
                      Add Field
                    </button>
                  </div>
                </>
              )}
            </div>

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

            {fieldDefinitions.length > 0 && (
              <div className="EntryForm-Fields">
                {fieldDefinitions.map((field) => (
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
                      {fieldDefinitions.map((field) => {
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
        </div>

        <div className="EmailTemplate">
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
                <>Add an entry above to preview with real values</>
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
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
