import { useEffect, useState } from 'react'
import './App.css'

const storageKey = 'mesPtaEntries'
const templateStorageKey = 'mesPtaEmailTemplate'
const subjectStorageKey = 'mesPtaEmailSubject'
const fieldDefinitionsStorageKey = 'mesPtaFieldDefinitions'

const toPlaceholder = (key) => `{{${key}}}`

const fillTemplate = (template, values) => {
  let result = template
  Object.entries(values).forEach(([key, value]) => {
    result = result.replaceAll(toPlaceholder(key), value)
  })
  return result
}

function App() {
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

  useEffect(() => {
    const saved = localStorage.getItem(storageKey)
    if (saved) {
      const parsedEntries = JSON.parse(saved)
      setEntries(parsedEntries)
      if (parsedEntries.length > 0) {
        setPreviewEntryId(parsedEntries[parsedEntries.length - 1].id)
      }
    }

    const savedTemplate = localStorage.getItem(templateStorageKey)
    if (savedTemplate) {
      setEmailTemplate(savedTemplate)
    }

    const savedSubject = localStorage.getItem(subjectStorageKey)
    if (savedSubject) {
      setEmailSubject(savedSubject)
    }

    const savedFieldDefinitions = localStorage.getItem(fieldDefinitionsStorageKey)
    if (savedFieldDefinitions) {
      setFieldDefinitions(JSON.parse(savedFieldDefinitions))
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(entries))
  }, [entries])

  useEffect(() => {
    localStorage.setItem(templateStorageKey, emailTemplate)
  }, [emailTemplate])

  useEffect(() => {
    localStorage.setItem(subjectStorageKey, emailSubject)
  }, [emailSubject])

  useEffect(() => {
    localStorage.setItem(fieldDefinitionsStorageKey, JSON.stringify(fieldDefinitions))
  }, [fieldDefinitions])

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

  const handleFieldValueChange = (key, value) => {
    setFieldValues((prev) => ({ ...prev, [key]: value }))
  }

  const handleAddFieldDefinition = () => {
    const key = newFieldKey.trim()
    const label = newFieldLabel.trim()
    if (!key || !label) return
    if (allFieldDefinitions.some((field) => field.key === key)) return

    setFieldDefinitions((prev) => [...prev, { id: Date.now(), key, label }])
    setNewFieldKey('')
    setNewFieldLabel('')
  }

  const handleRemoveFieldDefinition = (id) => {
    const field = fieldDefinitions.find((item) => item.id === id)
    setFieldDefinitions((prev) => prev.filter((item) => item.id !== id))
    if (field) {
      setFieldValues((prev) => {
        const next = { ...prev }
        delete next[field.key]
        return next
      })
    }
  }

  const handleLoadEntryForEdit = (entry) => {
    setEmail(entry.email)
    setCompanyName(entry.companyName)
    setFieldValues({ ...(entry.fieldValues || {}) })
    setEditingEntryId(entry.id)
    setPreviewEntryId(entry.id)
  }

  const handleCancelEdit = () => {
    setEditingEntryId(null)
    setEmail('')
    setCompanyName('')
    setFieldValues({})
  }

  const handleAdd = () => {
    if (!email.trim() || !companyName.trim()) return

    const savedFieldValues = {}
    fieldDefinitions.forEach((field) => {
      savedFieldValues[field.key] = fieldValues[field.key]?.trim() || ''
    })

    if (editingEntryId) {
      setEntries((prev) =>
        prev.map((entry) =>
          entry.id === editingEntryId
            ? {
                ...entry,
                email: email.trim(),
                companyName: companyName.trim(),
                fieldValues: savedFieldValues,
              }
            : entry
        )
      )
      setPreviewEntryId(editingEntryId)
    } else {
      const newEntry = {
        id: Date.now(),
        email: email.trim(),
        companyName: companyName.trim(),
        fieldValues: savedFieldValues,
      }

      setEntries((prev) => [...prev, newEntry])
      setPreviewEntryId(newEntry.id)
    }

    setEditingEntryId(null)
    setEmail('')
    setCompanyName('')
    setFieldValues({})
  }

  return (
    <div className="EntryForm">
      <div className="EntryForm-Container">
        <div className="EntryForm-Row">
        <div className="EntryForm-Left">
          <h1 className="EntryForm-Title">MES PTA</h1>
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
              Add fields to use in your email template, like {toPlaceholder('contactName')}.
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

          {/* <div className="EntryForm-FieldSetup">
            <h3 className="EntryForm-FieldSetupTitle">Dynamic Fields</h3>
            <p className="EntryForm-FieldSetupHint">
              Add fields to use in your email template, like {toPlaceholder('contactName')}.
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
                onChange={(e) => setNewFieldKey(e.target.value)}
                placeholder="Key (e.g. contactName)"
              />
              <button
                className="EntryForm-Button EntryForm-FieldAddButton"
                type="button"
                onClick={handleAddFieldDefinition}
              >
                Add Field
              </button>
            </div>
          </div> */}

     
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
              Use placeholders like{' '}
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
