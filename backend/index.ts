import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import Anthropic from '@anthropic-ai/sdk'
const app = express()



app.use(express.json())

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


let history: Anthropic.MessageParam[] = [
  {
    role: "user",
    content: "hey claude why did britain lose the revolutionary war?"
  },
  {
    role: "assistant",
    content:"Britain struggled to sustain a war fought 3,000 miles across the Atlantic, with overstretched supply lines and difficulty reinforcing troops, while facing a population that knew the terrain and was fighting for its own homeland.The entry of France, Spain, and the Netherlands turned a colonial rebellion into a global conflict, stretching British military resources to the breaking point and ultimately making the war unsustainable."
  }
]

/*
app.post('/hello', async (req: Request, res: Response) => {

  console.log('request', req)

  const body = req.body

  console.log('confirm body is just text', body.content)

  let newHistory: { role: string, content: {type: string, text: string}[]}[] = [];

  history.map(el => {
    newHistory.push(el)
  })

  let newObj = {
    role: `user`,
    content: [
      {
        type: 'text',
        text: `${body.content}`
      }
    ]
  }

  newHistory.push(newObj)
  //create new object to add to history, add request body to it
  //

  //query claude with existing history + new request, add resposne to object

  const response = await fetch('https://api.anthropic.com/v1/messages',{
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY as string,
      'anthropic-version': '2023-06-01'
    },
    body:
      //stringify bc request needs to be JSON
      JSON.stringify({
      'model': 'claude-haiku-4-5-20251001' as string,
      'max_tokens': 1000 as number,
      'messages': newHistory as []})
  })

  const claudeRes: claudeResponse = await response.json() as claudeResponse

  console.log('claude response', claudeRes.content[0])

  newHistory.push({ role: claudeRes.role, content: claudeRes.content })

  history = newHistory;

  //append obejct to history

  //return claude response only
  //
  res.json({role: claudeRes.role, content: claudeRes.content })

})
*/

app.post('/chat', async (req: Request, res: Response) => {

  console.log('request', req)

  const body = req.body

  console.log('confirm body is just text', body.content)

  let newHistory: Anthropic.MessageParam[]= [];

  history.map(el => {
    newHistory.push(el)
  })

  let newObj = {
    role: `user` as 'user',
    content: `${body.content}`
  }

  newHistory.push(newObj)

  const client = new Anthropic()

  const params: Anthropic.MessageCreateParams = {
    max_tokens: 1000,
    messages: newHistory,
    model: 'claude-haiku-4-5-20251001'
  }

  const message: Anthropic.Message = await client.messages.create(params);

  console.log('message received', message.content)

  newHistory.push({
    role: message.role,
    content: message.content
  })

  history = newHistory

  res.json(message.content)

  console.log('new history array', history)
})

const PORT = 3000

app.listen(PORT, () => {
  console.log(`listening on port ${PORT}`)
})
