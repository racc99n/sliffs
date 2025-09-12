// ===== netlify/functions/link-prima789-account.js =====
const {
  upsertPrima789Account,
  createAccountLink,
  logSystemEvent,
} = require('./utils/database')

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ message: 'Method Not Allowed' }),
    }
  }

  try {
    const { lineUserId, prima789Data } = JSON.parse(event.body)

    if (!lineUserId || !prima789Data || !prima789Data.username) {
      await logSystemEvent('LINKING_FAILED_MISSING_DATA', lineUserId, {
        message: 'Missing required parameters for account linking',
        data: prima789Data,
      })
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Missing required parameters.' }),
      }
    }

    // 1. Upsert (สร้างหรืออัปเดต) บัญชี Prima789 ในฐานข้อมูลของเรา
    const prima789User = await upsertPrima789Account(prima789Data)

    // 2. สร้างการเชื่อมโยงระหว่าง LINE User ID กับ Prima789 Account ID
    const newLink = await createAccountLink(lineUserId, prima789User.account_id)

    await logSystemEvent('ACCOUNT_LINKED_SUCCESS', lineUserId, {
      message: `Successfully linked LINE user to Prima789 account: ${prima789Data.username}`,
      linkId: newLink.linking_id,
    })

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Account linked successfully',
        linkId: newLink.linking_id,
        prima789Account: prima789User,
      }),
    }
  } catch (error) {
    console.error('Account linking function error:', error)
    await logSystemEvent(
      'LINKING_FUNCTION_ERROR',
      null,
      {
        message: error.message,
      },
      'error'
    )

    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Internal Server Error' }),
    }
  }
}
