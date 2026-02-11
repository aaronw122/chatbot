import type { Message, Messages, Conversation, CreateConversation} from '../types/types'



interface Storage {

  addMessage({convoId}:{convoId: string}): Message

  createConversation({ message, userId }: CreateConversation): Conversation

  getConversation({convoId}: {convoId: string}): Conversation

  getConversations({ userId }: { userId: string }): Conversation[]

  saveConversation({ convoId }: { convoId: string }): Conversation

  deleteConversation({convoId}: { convoId: string }): void

}

class InMemoryStorage implements Storage {
  private conversations: Map<string, Conversation>
  private messages: Map<string, Message>

  //conversation can only be created if one message has been sent
  // upon sending message, we create conversation AND add it to message class with that convo id

  createConversation({ message, userId }: CreateConversation) {
    const convo: Conversation = {
      id: crypto.randomUUID(),
      userId,
      title:
    }

    //check message isn't null

    conversations.set(userId, conversation)
  }

  //anytime you add a message it needs to be in context of the conversation, use convoId to properly append
  addMessage() {
     this.messages.set(message.convoId, message)
   }
}
