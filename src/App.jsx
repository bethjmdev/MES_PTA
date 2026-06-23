import { useEffect, useState } from 'react'
import './App.css'

const storageKey = 'mesPtaEntries'

function App() {
  const [email, setEmail] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [entries, setEntries] = useState([])

  useEffect(() => {
    const saved = localStorage.getItem(storageKey)
    if (saved) {
      setEntries(JSON.parse(saved))
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(entries))
  }, [entries])

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
    </div>
  )
}

export default App
