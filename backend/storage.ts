import type { Message, Messages, Conversation, CreateConversation, MessageType, Content, CleanMessage} from '../types/types'
import { supabaseAdmin } from './supabaseClient'



export interface Storage {
  addMessage({ convoId, role, content }: MessageType): Promise<CleanMessage>

  createConversation({ content, userId }: CreateConversation): Promise<Conversation>

  getConversation({ convoId }: { convoId: string }): Promise<Message[] | []>

  getConversations({ userId }: { userId: string }): Promise<Conversation[]>

  saveConversation({ convoId }: { convoId: string }): Promise<Conversation>

  deleteConversation({convoId}: { convoId: string }): Promise<void>
}

export class InMemoryStorage implements Storage {
  //creates a map with key being convoId, value being a list of conversations
  private conversations: Map<string, Conversation> = new Map()
  private messages: Map<string, Message> = new Map()

  //conversation can only be created if one message has been sent
  // upon sending message, we create conversation AND add it to message class with that convo id

  //create conversation will alwyas be initiated by the user, hence content will always be of type string
  async createConversation({ content, userId, save }: CreateConversation): Promise<Conversation> {

    let trimTitle = content.split(' ').slice(0, 4).join(' ')

    const convo: Conversation = {
      id: crypto.randomUUID(),
      userId,
      title: trimTitle,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      save: save ? save : true
    }

    //check message isn't null
    if (!content) {
      throw new Error('no message in the conversation to create it')
    }

    //else create conversation
    this.conversations.set(convo.id, convo )

    return convo
  }

  //anytime you add a message it needs to be in context of the conversation, use convoId to properly append
  async addMessage({ convoId, role, content }: MessageType): Promise<CleanMessage> {
    if (content === null || content === undefined) {
      throw new Error
    }
    if (typeof content !== 'string') {
      //later can add others for multimodality
      if (content[0]?.type === 'text') {
        const parsedMsg = {
          id: crypto.randomUUID(),
          convoId: convoId,
          role: role,
          content: content[0].text,
          createdAt: new Date().toISOString()
        }
        this.messages.set(parsedMsg.id, parsedMsg)
        return parsedMsg
      }
      throw new Error('non-text is not supported')
    }
    else {
      const msg: CleanMessage = {
        id: crypto.randomUUID(),
        convoId: convoId,
        role: role,
        content: content,
        createdAt: new Date().toISOString()
      }
      this.messages.set(msg.id, msg)
      return msg
    }
  }

  //a bit extra, but will be good when we scale to auth
  async getConversations({ userId }: { userId: string }) {

    const convoArr = [...this.conversations.values()]

    const userConvos = convoArr.filter(el => el.userId === userId)

    if (userConvos.length === 0) {
      return []
    }
    //for now content is just a string, we will not permit others
    console.log('user Convos', userConvos)
    return userConvos
  }

  async getConversation({ convoId }: { convoId: string }) {

    const messageArr = [...this.messages.values()]

    console.log('messageArr', messageArr)

    const convoMessages = messageArr.filter(el => el.convoId === convoId)

    if (convoMessages.length === 0) {
      return []
    }
    //for now content is just a string, we will not permit others
    console.log('user Convos', convoMessages)
    return convoMessages
  }

  //for when a bubble is expanded to a full convo
  async saveConversation({ convoId }: { convoId: string }) {
    const bubbleConvo = this.conversations.get(convoId) as Conversation

    const fullConvo = {
      id: bubbleConvo.id,
      userId: bubbleConvo.userId,
      title: bubbleConvo.title,
      createdAt: bubbleConvo.createdAt,
      updatedAt: bubbleConvo.updatedAt,
      save: true
    }

    this.conversations.set(convoId, fullConvo)

    return fullConvo
  }

  async deleteConversation({ convoId }: { convoId: string }) {
    //need to both delete the convo and the messages with its id
    const messageArr = [...this.messages.values()]

    const messagesToDelete = messageArr.filter(el => el.convoId === convoId)

    messagesToDelete.map(el => {
      this.messages.delete(el.id)
    })

    this.conversations.delete(convoId)
  }
  async resetConversations() {
    //need to both delete the convo and the messages with its id
    const newConvos = new Map()
    this.conversations = newConvos
    const newMessages= new Map()
    this.messages = newMessages
  }
}

export class SupabaseStorage implements Storage {
  async createConversation({ content, userId, save }: CreateConversation): Promise<Conversation> {
    let trimTitle = content.split(' ').slice(0, 4).join(' ')

    //every supabase quyery returns object with data and error
    const { data, error } = await supabaseAdmin
      .from('conversations')

      // inserts a new row, mapping from camel to snake
      .insert({
        user_id: userId,
        title: trimTitle,
        save: save ?? true,
      })
      //similar to sql, return row back to us
      .select()
      //unwraps array to become a single object
      .single()

    if (error) throw error

    return {
      id: data.id,
      userId: data.user_id,
      title: data.title,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      save: data.save
    }
  }
  async addMessage({ convoId, role, content }: MessageType): Promise<CleanMessage> {
    if (content === null || content === undefined) {
      throw new Error
    }
    let text = ''

    //normalize string here
    if (typeof content === 'string') {
      text = content
    }
    else if (content[0]?.type === 'text') {
        text = content[0].text
    }
    else {
      throw new Error('non-text is not supported')
    }

    const { data, error } = await supabaseAdmin
      .from('messages')
      .insert({
        convo_id: convoId,
        content: text,
        role: role
      })
      .select()
      .single()
    if (error) throw error

    return {
      id: data.id,
      convoId: data.convo_id,
      role: data.role,
      content: data.content,
      createdAt: data.created_at
    }
  }
}
