import { describe, it, expect, beforeEach } from "bun:test";
import { InMemoryStorage } from "../storage";
import { expectedUserConvos, messageExample } from '../utils/testHelper'
import type { Conversation, Message } from "../../types/types";

const storage = new InMemoryStorage();


beforeEach(async () => {
  storage.resetConversations();
})

const addBaseConvoMsg = () => {
  //mimicks a normal request someone would make
  storage.createConversation({ content: "jack the rabbit hit the", userId: "12" })
  const convoJack = storage.getConversations({ userId: "12" })[0] as Conversation
  storage.addMessage({ convoId: convoJack.id, content: "jack the rabbit hit the juice, found everything about it", role: "user" })


  storage.createConversation({ content: "old lady and the shoe, got me blue, hit the juice", userId: "12" })
  const convoLady = storage.getConversations({ userId: "12" })[1] as Conversation
  storage.addMessage({ convoId: convoLady.id, content: "old lady and the shoe, got me blue, hit the juice", role: "user" })

  storage.createConversation({ content: "lone wolf cried at the moon, and didnt look back", userId: "23" })
  const convoWolf = storage.getConversations({ userId: "23" })[0] as Conversation
  storage.addMessage({ convoId: convoWolf.id, content: "lone wolf cried at the moon, and didnt look back", role: "user"})

  storage.addMessage({ convoId: convoJack.id, content: "thats craaaazy", role: "assistant"})
  storage.addMessage({ convoId: convoLady.id, content: "idk about that", role: "assistant" })
}

describe('conversation can be created + fetch works', () => {
  it('reset convos works', () => {
    storage.createConversation({ content: "jack the rabbit hit the", userId: "12" })
    storage.resetConversations()
    expect(storage.getConversations({ userId: '12'})).toEqual([])
  })
  it('one conversation is created when none exist', () => {
    addBaseConvoMsg()
    const realConvos = storage.getConversations({ userId: '12' })
    expect(realConvos).toHaveLength(2);
    expect(realConvos[0]!.save).toBe(true)
    expect(realConvos[0]).toMatchObject(expectedUserConvos[0]!)
  })
  it('one convo is created when another already exists, same user', () => {
    storage.createConversation({ content: "jack the rabbit hit the", userId: "12" })
    storage.createConversation({ content: "old lady and the shoe, got me blue, hit the juice", userId: "12" })
    const realConvos = storage.getConversations({ userId: '12' })
    expect(realConvos).toHaveLength(2);
    expect(realConvos[1]).toMatchObject(expectedUserConvos[1]!)
  })
})
describe('message work', () => {
  it('messages are in right shape + available',  () => {
    addBaseConvoMsg()
    const realConvo = storage.getConversations({ userId: '12' })[0] as Conversation
    const mockId = realConvo.id
    const messages = storage.getConversation({ convoId: mockId })
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
  it('save is set to true when invoked', () => {
    const convo = storage.createConversation(({ content: "he died on the ledge", userId: "23", save: false}))
    const newConvo = storage.saveConversation({ convoId: convo.id })
    expect(newConvo.save).toBe(true)
  })
})
