import { useEffect, useState } from 'react'
import './App.css'

const storageKey = 'mesPtaEntries'
const templateStorageKey = 'mesPtaEmailTemplate'
const subjectStorageKey = 'mesPtaEmailSubject'
const companyPlaceholder = '{{companyName}}'

function App() {
  const [email, setEmail] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [entries, setEntries] = useState([])
  const [emailSubject, setEmailSubject] = useState('')
  const [emailTemplate, setEmailTemplate] = useState('')

  useEffect(() => {
    const saved = localStorage.getItem(storageKey)
    if (saved) {
      setEntries(JSON.parse(saved))
    }

    const savedTemplate = localStorage.getItem(templateStorageKey)
    if (savedTemplate) {
      setEmailTemplate(savedTemplate)
    }

    const savedSubject = localStorage.getItem(subjectStorageKey)
    if (savedSubject) {
      setEmailSubject(savedSubject)
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

  const fillTemplate = (template, name) => {
    return template.replaceAll(companyPlaceholder, name)
  }

  const previewCompanyName = companyName.trim() || 'Your Company'
  const previewSubject = fillTemplate(emailSubject, previewCompanyName)
  const previewText = fillTemplate(emailTemplate, previewCompanyName)

  const handleAdd = () => {
    if (!email.trim() || !companyName.trim()) return

    const newEntry = {
      id: Date.now(),
      email: email.trim(),
      companyName: companyName.trim(),
    }

    setEntries((prev) => [...prev, newEntry])
    setEmail('')
    setCompanyName('')
  }

  return (
    <div className="EntryForm">
      <div className="EntryForm-Container">
        <div className="EntryForm-Row">
        <div className="EntryForm-Left">
          <h1 className="EntryForm-Title">MES PTA</h1>

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

          <button className="EntryForm-Button" type="button" onClick={handleAdd}>
            Add
          </button>
        </div>

        <div className="EntryForm-Right">
          <h2 className="EntryForm-ListTitle">Entries</h2>

          {entries.length === 0 ? (
            <p className="EntryForm-Empty">No entries yet</p>
          ) : (
            <ul className="EntryForm-List">
              {entries.map((entry) => (
                <li key={entry.id} className="EntryForm-ListItem">
                  <span className="EntryForm-ListEmail">{entry.email}</span>
                  <span className="EntryForm-ListCompany">{entry.companyName}</span>
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
              Use <code>{companyPlaceholder}</code> where the company name should appear.
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
              placeholder={`Follow up with ${companyPlaceholder}`}
            />

            <label className="EmailTemplate-Label" htmlFor="emailTemplate">
              Template
            </label>
            <textarea
              id="emailTemplate"
              className="EmailTemplate-Textarea"
              value={emailTemplate}
              onChange={(e) => setEmailTemplate(e.target.value)}
              placeholder={`Hi ${companyPlaceholder},\n\nWe wanted to reach out about...`}
              rows={6}
            />

            <h3 className="EmailTemplate-PreviewTitle">Preview</h3>
            <p className="EmailTemplate-PreviewHint">
              Showing with company name: <strong>{previewCompanyName}</strong>
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
