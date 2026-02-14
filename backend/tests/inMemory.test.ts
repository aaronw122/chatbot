import { describe, it, expect, beforeEach } from "bun:test";
import { InMemoryStorage } from "../db/storage";
import { expectedUserConvos, messageExample } from '../utils/testHelper'
import type { Conversation, Message } from "../../types/types";

const storage = new InMemoryStorage();


beforeEach(async () => {
  storage.resetConversations();
})

const addBaseConvoMsg = async () => {
  //mimicks a normal request someone would make
  await storage.createConversation({ content: "jack the rabbit hit the", userId: "12" })
  await storage.createConversation({ content: "old lady and the shoe, got me blue, hit the juice", userId: "12" })

  const convoUser12 = await storage.getConversations({ userId: "12" }) as Conversation[]
  console.log('convoUser12', convoUser12)

  const convoJack = convoUser12[0] as Conversation
  await storage.addMessage({ convoId: convoJack.id, content: "jack the rabbit hit the juice, found everything about it", role: "user" })
  await storage.addMessage({ convoId: convoJack.id, content: "thats craaaazy", role: "assistant"})


  const convoLady = convoUser12[1] as Conversation
  await storage.addMessage({ convoId: convoLady.id, content: "old lady and the shoe, got me blue, hit the juice", role: "user" })
  await storage.addMessage({ convoId: convoLady.id, content: "idk about that", role: "assistant" })


  await storage.createConversation({ content: "lone wolf cried at the moon, and didnt look back", userId: "23" })

  const convo23 = await storage.getConversations({ userId: "23" })

  const convoWolf = convo23[0] as Conversation
  await storage.addMessage({ convoId: convoWolf.id, content: "lone wolf cried at the moon, and didnt look back", role: "user"})
}

describe('conversation can be created + fetch works', () => {
  it('reset convos works', async () => {
    await storage.createConversation({ content: "jack the rabbit hit the", userId: "12" })
    await storage.resetConversations()
    const newConvos = await storage.getConversations({ userId: '12'})
    expect(newConvos).toEqual([])
  })
  it('one conversation is created when none exist', async() => {
    await addBaseConvoMsg()
    const realConvos = await storage.getConversations({ userId: '12' })
    console.log('real convos', realConvos)
    expect(realConvos).toHaveLength(2);
    expect(realConvos[0]!.save).toBe(true)
    expect(realConvos[0]).toMatchObject(expectedUserConvos[0]!)
  })
  it('one convo is created when another already exists, same user', async () => {
    await storage.createConversation({ content: "jack the rabbit hit the", userId: "12" })
    await storage.createConversation({ content: "old lady and the shoe, got me blue, hit the juice", userId: "12" })
    const realConvos = await storage.getConversations({ userId: '12' })
    expect(realConvos).toHaveLength(2);
    expect(realConvos[1]).toMatchObject(expectedUserConvos[1]!)
  })
})
describe('message work', () => {
  it('messages are in right shape + available',  async () => {
    await addBaseConvoMsg()
    const Convos = await storage.getConversations({ userId: '12' })
    const realConvo = Convos[0] as Conversation
    const mockId = realConvo.id
    const messages = await storage.getMessages({ convoId: mockId })
    expect(messages).toHaveLength(2)
    expect(messages[0]).toMatchObject(messageExample)
    expect(messages[0]).toHaveProperty('id');
    expect(messages[0]).toHaveProperty('convoId');
    expect(messages[0]).toHaveProperty('role');
    expect(messages[0]).toHaveProperty('content');
    expect(messages[0]).toHaveProperty('createdAt');
  })
})
describe('delete convo work', () => {
  it('messages are in right shape + available', () => {

  })
})
describe('save convo work', () => {
  it('save is set to true when invoked', async () => {
    const convo = await storage.createConversation(({ content: "he died on the ledge", userId: "23", save: false}))
    const newConvo = await storage.saveConversation({ convoId: convo.id })
    expect(newConvo.save).toBe(true)
  })
})
