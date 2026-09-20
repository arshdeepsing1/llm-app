import { test } from 'node:test'
import assert from 'node:assert/strict'
import { api, apiJsonText, setToken } from '../src/api.ts'

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: {'Content-Type':'application/json'} })

test('a rejected stale token refreshes once and the action executes once', async t => {
  const calls = []
  let executions = 0
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push(url)
    if (url === '/api/bootstrap') return json({token:'fresh'})
    if (options.headers['X-Local-Token'] === 'old') return json({code:'reconnect_required',detail:'Reconnect'},403)
    executions++
    assert.equal(options.headers['X-Local-Token'],'fresh')
    assert.equal(options.body,JSON.stringify({text:'hello'}))
    return json({ok:true})
  })
  setToken('old')
  assert.deepEqual(await api('/sessions/test/messages','POST',{text:'hello'}),{ok:true})
  assert.equal(executions,1)
  assert.deepEqual(calls,['/api/sessions/test/messages','/api/bootstrap','/api/sessions/test/messages'])
})

test('authorization rejection and server failure do not replay actions', async t => {
  for (const status of [403,500]) {
    let requests = 0
    const mock = t.mock.method(globalThis,'fetch',async () => { requests++;return json({detail:'Rejected'},status) })
    await assert.rejects(api('/command','POST',{text:'do something'}),/Rejected/)
    assert.equal(requests,1)
    mock.mock.restore()
  }
})

test('connection loss after sending does not replay a possibly executed action', async t => {
  let requests = 0
  t.mock.method(globalThis,'fetch',async () => { requests++;throw new TypeError('Connection lost') })
  await assert.rejects(api('/command','POST',{text:'do something'}),/Connection lost/)
  assert.equal(requests,1)
})

test('raw conversation JSON keeps duplicate keys and number text through token refresh', async t => {
  const body = '{"version":1,"version":2,"large":9007199254740993,"invalid":NaN}'
  const sent = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url === '/api/bootstrap') return json({ token: 'fresh-import' })
    sent.push(options.body)
    if (options.headers['X-Local-Token'] === 'old-import') return json({ code: 'reconnect_required' }, 403)
    assert.equal(options.headers['X-Local-Token'], 'fresh-import')
    return json({ detail: 'Invalid bundle' }, 400)
  })
  setToken('old-import')
  await assert.rejects(apiJsonText('/sessions/import?workspace=%2Fproject', body), /Invalid bundle/)
  assert.deepEqual(sent, [body, body])
})
