const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { defineSecret } = require('firebase-functions/params')
const { initializeApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const nodemailer = require('nodemailer')

initializeApp()

const gmailUser = defineSecret('GMAIL_USER')
const gmailAppPassword = defineSecret('GMAIL_APP_PASSWORD')
const bccEmail = defineSecret('BCC_EMAIL')

const fillTemplate = (template, values) => {
  let result = template
  Object.entries(values).forEach(([key, value]) => {
    result = result.replaceAll(`{{${key}}}`, value ?? '')
  })
  return result
}

exports.sendEmails = onCall(
  { secrets: [gmailUser, gmailAppPassword, bccEmail] },
  async (request) => {
    const { databaseName, entries, subject, template } = request.data || {}

    if (!databaseName || !Array.isArray(entries) || entries.length === 0) {
      throw new HttpsError('invalid-argument', 'Missing databaseName or entries.')
    }

    if (!subject?.trim() || !template?.trim()) {
      throw new HttpsError('invalid-argument', 'Subject and template are required.')
    }

    const from = gmailUser.value()
    const bcc = bccEmail.value()
    const db = getFirestore()

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: from,
        pass: gmailAppPassword.value(),
      },
    })

    const results = { sent: [], failed: [] }

    for (const entry of entries) {
      if (!entry.email?.trim()) {
        results.failed.push({ id: entry.id, error: 'Missing email address.' })
        continue
      }

      const values = entry.values || {}
      const filledSubject = fillTemplate(subject, values)
      const filledBody = fillTemplate(template, values)

      try {
        await transporter.sendMail({
          from,
          to: entry.email.trim(),
          bcc,
          subject: filledSubject,
          text: filledBody,
        })

        await db.collection(databaseName).doc(entry.id).update({ email_sent: 'Y' })
        results.sent.push(entry.id)
      } catch (err) {
        results.failed.push({ id: entry.id, error: err.message || 'Send failed.' })
      }
    }

    return results
  }
)
