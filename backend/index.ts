import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import Anthropic from '@anthropic-ai/sdk'
import type{WSmap} from '../types/types'
import expressWs, { type Application } from 'express-ws';
import cors from 'cors';
import type { WebSocket } from 'ws';
const app = express()

app.use(express.json())

expressWs(app)

const wsApp = app as unknown as Application;

app.use(cors({ origin: 'http://localhost:5173' }))

type claudeResponse = {
  id: string,
  type: "message" | "image",
  role: "assistant" | "user",
  content: { type: "text"; text: string }[],
  stop_reason: "end_turn" | "max_tokens" | "tool_use" | null;
  stop_sequence: string | null,
  usage?: {
    input_tokens: number,
    output_tokens: number
  },
}

//complete DB in mongo



//user history
let history: (Anthropic.MessageParam & { id: string })[] = [
  {
    role: "user",
    content: "hey claude why did britain lose the revolutionary war?",
    id: "1"
  },
  {
    role: "assistant",
    content: "Britain struggled to sustain a war fought 3,000 miles across the Atlantic, with overstretched supply lines and difficulty reinforcing troops, while facing a population that knew the terrain and was fighting for its own homeland.The entry of France, Spain, and the Netherlands turned a colonial rebellion into a global conflict, stretching British military resources to the breaking point and ultimately making the war unsustainable.",
    id: "2"
  }
]

const wsMap: WSmap = new Map<string, Set<WebSocket>>

//pass through whole new array each Req

//right now its simpler, so i will pass through a mock string, but likely will want enabled for multiple chats nayways
const sendNewMessage = (id: string, history: (Anthropic.MessageParam & { id: string })[]) => {
  //send id of 1 thru the post request
  const connections = wsMap.get('1')

  console.log('updating chat, connections:', connections)

  if (connections) {
    connections.forEach(ws => {
      console.log('ready state?', ws.readyState)

      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({
          type: 'updateChat',
          history
        }))
      }
    });
  }
}

wsApp.ws('/chat/ws', (ws: WebSocket, req) => {

  //later will check for id generally and have some checks on if the id even exists in history object
  if (!wsMap.has('1')) {
    wsMap.set('1', new Set())
  }

  wsMap.get('1')!.add(ws);

  //once we refactor, fetch exact sessionId history, then check if exists + send.

  if (history) {
    ws.send(JSON.stringify({
      type: 'updateChat',
      history
    }));
  }

  ws.on('close', () => {
    const connections = wsMap.get('1')
    if (connections) {
      connections.delete(ws)
      if (connections.size === 0) {
        wsMap.delete('1')
      }
    }
  })

  ws.on('error', (error) => {
    console.error('websocket error:', error)
  })

})


app.get('/chat', async (req: Request, res: Response) => {
  res.json(history)
})

app.post('/chat', async (req: Request, res: Response) => {

  const body = req.body

  console.log('confirm body is just text', body)

   console.log('confirm content', body.content)

  let newHistory: (Anthropic.MessageParam & { id: string })[]= [];

  history.map(el => {
    newHistory.push(el)
  })

  let newObj = {
    role: `user` as 'user',
    content: `${body.content}`,
    id: crypto.randomUUID()
  }

  newHistory.push(newObj)

  history = newHistory

  sendNewMessage('1', history)

  const client = new Anthropic()

  const params: Anthropic.MessageCreateParams = {
    max_tokens: 1000,
    messages: newHistory.map(({ id, ...rest }) => rest),
    model: 'claude-haiku-4-5-20251001'
  }

  const message: Anthropic.Message = await client.messages.create(params);

  console.log('message received', message.content)

  newHistory.push({
    role: message.role,
    content: message.content,
    id: crypto.randomUUID()
  })

  history = newHistory

  sendNewMessage('1', history)

  res.json(message.content)

  console.log('new history array', history)
})

app.post('/reset', async (req: Request, res: Response) => {
  const newHistory: (Anthropic.MessageParam & { id: string })[]= []
  history = newHistory
  sendNewMessage('1', history)
  res.json(history)
})

const PORT = 3000

app.listen(PORT, () => {
  console.log(`listening on port ${PORT}`)
})
