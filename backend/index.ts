import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import Anthropic from '@anthropic-ai/sdk'
import cors from 'cors';
const app = express()

app.use(express.json())

app.use(cors({origin: 'http://localhost:5173'}))

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

  res.json(message.content)

  console.log('new history array', history)
})

app.post('/reset', async (req: Request, res: Response) => {
  const newHistory: (Anthropic.MessageParam & { id: string })[]= []
  history = newHistory
  res.json(history)
})

const PORT = 3000

app.listen(PORT, () => {
  console.log(`listening on port ${PORT}`)
})
