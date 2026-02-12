import type { Message, Messages, Conversation, CreateConversation, MessageType} from '../types/types'



export interface Storage {
  addMessage({ convoId, role, content }: MessageType): Message

  createConversation({ content, userId }: CreateConversation): Conversation

  getConversation({ convoId }: { convoId: string }): Message[] | []

  getConversations({ userId }: { userId: string }): Conversation[]

  saveConversation({ convoId }: { convoId: string }): Conversation

  deleteConversation({convoId}: { convoId: string }): void
}

export class InMemoryStorage implements Storage {
  //creates a map with key being convoId, value being a list of conversations
  private conversations: Map<string, Conversation> = new Map()
  private messages: Map<string, Message> = new Map()

  //conversation can only be created if one message has been sent
  // upon sending message, we create conversation AND add it to message class with that convo id

  //create conversation will alwyas be initiated by the user, hence content will always be of type string
  createConversation({ content, userId, save }: CreateConversation): Conversation {

    let trimTitle = content.split(' ').slice(0, 7).join(' ')

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
  addMessage({ convoId, role, content }: MessageType) {

    const msg: Message = {
      id: crypto.randomUUID(),
      convoId: convoId,
      role: role,
      content: content,
      createdAt: new Date().toISOString()
    }
    //for now content is just a string, we will not permit others
    if (content === null || content === undefined) {
      throw new Error
    }

    this.messages.set(msg.id, msg)
    return msg

  }

  //a bit extra, but will be good when we scale to auth
  getConversations({ userId }: { userId: string }) {

    const convoArr = [...this.conversations.values()]

    const userConvos = convoArr.filter(el => el.userId === userId)

    if (userConvos.length === 0) {
      return []
    }
    //for now content is just a string, we will not permit others
    console.log('user Convos', userConvos)
    return userConvos
  }

  getConversation({ convoId }: { convoId: string }) {

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
  saveConversation({ convoId }: { convoId: string }) {
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

  deleteConversation({ convoId }: { convoId: string }) {
    //need to both delete the convo and the messages with its id
    const messageArr = [...this.messages.values()]

    const messagesToDelete = messageArr.filter(el => el.convoId === convoId)

    messagesToDelete.map(el => {
      this.messages.delete(el.id)
    })

    this.conversations.delete(convoId)
  }
  resetConversations() {
    //need to both delete the convo and the messages with its id
    const newConvos = new Map()
    this.conversations = newConvos
    const newMessages= new Map()
    this.messages = newMessages
  }
}
