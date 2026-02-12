//save for later when i test express.

const conversation1 = {
  id: '2',
  userId: 'bob',
  title: 'is the world round? ',
  createdAt: '2026-02-11T21:29:05.226Z',
  updatedAt: '2026-02-11T21:29:05.226Z',
  save: true
}

const conversation2 = {}

const messages = [
  {
    id: 'abc',
    convoId: '2',
    role: 'user',
    content: 'is the world round? what do you think? be honest. ',
    createdAt: new Date().toISOString()
  },
  {
    id: 'ade',
    convoId: '2',
    role: 'assistant',
    content: 'definitely not. checkout the flat earthers community.',
    createdAt: new Date().toISOString()
  },
]

export const expectedUserConvos = [
  {
    userId: '12',
    title: 'jack the rabbit hit the',
    save: true
  },
  {
    userId: '12',
    title: 'old lady and the shoe, got me',
    save: true
  },
]

export const messageExample = {
  content: "jack the rabbit hit the juice, found everything about it",
  role: "user"
}
