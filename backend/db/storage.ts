import type { Message, Messages, Conversation, CreateConversation, MessageType, Content, CleanMessage, Provider, UserKeyMeta } from '../../types/types'
import { supabaseAdmin } from './supabaseClient'
import { encrypt, decrypt } from '../utils/crypto'

// Internal decrypted shape returned only on the request path (never to the browser).
export type ActiveKey = { provider: Provider; model: string; apiKey: string }

// Format a masked display string from a decrypted key, e.g. "sk-…1234".
// The frontend never receives or formats raw key material.
function maskKey(plaintext: string): string {
  const last4 = plaintext.slice(-4)
  return `sk-…${last4}`
}

export interface Storage {
  addMessage({ convoId, role, content }: MessageType): Promise<CleanMessage>

  createConversation({ content, userId }: CreateConversation): Promise<Conversation>

  getMessages({ convoId }: { convoId: string }): Promise<Message[] | []>

  getConversations({ userId }: { userId: string }): Promise<Conversation[]>

  getConversation({ convoId }: { convoId: string }): Promise<Conversation | null>

  saveConversation({ convoId }: { convoId: string }): Promise<Conversation>

  //deleteConversation({convoId}: { convoId: string }): Promise<void>

  // BYOK (Phase 1) — per-user encrypted API key CRUD.
  // MF5: upsertApiKey never reads or writes is_active. Activation happens only via
  // the "first key" branch in POST /api/keys or explicit setActiveProvider.
  upsertApiKey({ userId, provider, encryptedKey, model }: { userId: string; provider: Provider; encryptedKey: string; model: string }): Promise<UserKeyMeta>

  listApiKeys({ userId }: { userId: string }): Promise<UserKeyMeta[]>

  deleteApiKey({ userId, provider }: { userId: string; provider: Provider }): Promise<void>

  // Set the chosen provider active; clear is_active on all others for the user.
  setActiveProvider({ userId, provider }: { userId: string; provider: Provider }): Promise<void>

  // Internal — returns the decrypted active key for the request path, or null.
  getActiveKey({ userId }: { userId: string }): Promise<ActiveKey | null>
}

// Internal row shape held by InMemoryStorage for API keys.
type ApiKeyRow = {
  userId: string
  provider: Provider
  encryptedKey: string
  model: string
  isActive: boolean
  updatedAt: string
}

export class InMemoryStorage implements Storage {
  //creates a map with key being convoId, value being a list of conversations
  private conversations: Map<string, Conversation> = new Map()
  private messages: Map<string, Message> = new Map()
  // Keyed by `${userId}:${provider}` to enforce one row per (user, provider).
  private apiKeys: Map<string, ApiKeyRow> = new Map()

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

  async getConversation({ convoId }: { convoId: string }): Promise<Conversation | null> {
    return this.conversations.get(convoId) ?? null
  }

  async getMessages({ convoId }: { convoId: string }) {

    const messageArr = [...this.messages.values()]

    console.log('messageArr', messageArr)

    const convoMessages = messageArr.filter(el => el.convoId === convoId)

    if (convoMessages.length === 0) {
      return []
    }
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
    this.apiKeys = new Map()
  }

  // ----- BYOK: API key CRUD -----

  private keyOf(userId: string, provider: Provider): string {
    return `${userId}:${provider}`
  }

  // MF5: never touches is_active. Insert preserves false default; update on an
  // existing (user, provider) row leaves is_active unchanged (key rotation).
  async upsertApiKey({ userId, provider, encryptedKey, model }: { userId: string; provider: Provider; encryptedKey: string; model: string }): Promise<UserKeyMeta> {
    const key = this.keyOf(userId, provider)
    const existing = this.apiKeys.get(key)
    const row: ApiKeyRow = {
      userId,
      provider,
      encryptedKey,
      model,
      isActive: existing ? existing.isActive : false,
      updatedAt: new Date().toISOString(),
    }
    this.apiKeys.set(key, row)
    return {
      provider: row.provider,
      model: row.model,
      isActive: row.isActive,
      maskedKey: maskKey(decrypt(row.encryptedKey)),
      updatedAt: row.updatedAt,
    }
  }

  async listApiKeys({ userId }: { userId: string }): Promise<UserKeyMeta[]> {
    return [...this.apiKeys.values()]
      .filter((row) => row.userId === userId)
      .map((row) => ({
        provider: row.provider,
        model: row.model,
        isActive: row.isActive,
        maskedKey: maskKey(decrypt(row.encryptedKey)),
        updatedAt: row.updatedAt,
      }))
  }

  // Med7: if the deleted key was active and another provider key remains, promote
  // the most-recently-updated remaining key to active. If none remain, gated state.
  async deleteApiKey({ userId, provider }: { userId: string; provider: Provider }): Promise<void> {
    const key = this.keyOf(userId, provider)
    const deleted = this.apiKeys.get(key)
    this.apiKeys.delete(key)

    if (deleted?.isActive) {
      const remaining = [...this.apiKeys.values()].filter((row) => row.userId === userId)
      if (remaining.length > 0) {
        // pick the max updatedAt (most recently updated)
        const promote = remaining.reduce((a, b) => (a.updatedAt >= b.updatedAt ? a : b))
        promote.isActive = true
      }
    }
  }

  async setActiveProvider({ userId, provider }: { userId: string; provider: Provider }): Promise<void> {
    const target = this.apiKeys.get(this.keyOf(userId, provider))
    if (!target) {
      throw new Error(`no key for provider "${provider}"`)
    }
    for (const row of this.apiKeys.values()) {
      if (row.userId === userId) {
        row.isActive = row.provider === provider
      }
    }
  }

  async getActiveKey({ userId }: { userId: string }): Promise<ActiveKey | null> {
    const active = [...this.apiKeys.values()].find((row) => row.userId === userId && row.isActive)
    if (!active) return null
    return {
      provider: active.provider,
      model: active.model,
      apiKey: decrypt(active.encryptedKey),
    }
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
  async getConversations({ userId }: { userId: string }) {
    const { data, error } = await supabaseAdmin
      .from('conversations')
      .select()
      .eq('user_id', userId)
      .order('created_at', { ascending: false })

    if (error) throw error

    return (data.map((row) => ({
      id: row.id,
      userId: row.user_id,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      save: row.save
    })))
  }
  async getConversation({ convoId }: { convoId: string }): Promise<Conversation | null> {
    const { data, error } = await supabaseAdmin
      .from('conversations')
      .select()
      .eq('id', convoId)
      .maybeSingle()

    if (error) throw error
    if (!data) return null

    return {
      id: data.id,
      userId: data.user_id,
      title: data.title,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      save: data.save
    }
  }
  async getMessages({ convoId }: { convoId: string }) {
    const { data, error } = await supabaseAdmin
      .from('messages')
      .select()
      .eq('convo_id', convoId)

    if (error) throw error
    return (data.map(row => ({
      id: row.id,
      convoId: row.convo_id,
      role: row.role,
      content: row.content,
      createdAt: row.created_at
    })))
  }
  async saveConversation({ convoId }: { convoId: string }) {
    const { data, error } = await supabaseAdmin
      .from('conversations')
      .update({
        save: true
      })
      .eq('id', convoId)
      .select()
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

  // ----- BYOK: API key CRUD (all queries filter user_id in WHERE) -----

  // MF5: upsert never reads or writes is_active. On conflict (user_id, provider)
  // we update encrypted_key + model + updated_at only; is_active is left as-is
  // (DB column keeps its prior value on update; new rows default false).
  async upsertApiKey({ userId, provider, encryptedKey, model }: { userId: string; provider: Provider; encryptedKey: string; model: string }): Promise<UserKeyMeta> {
    const { data, error } = await supabaseAdmin
      .from('user_api_keys')
      .upsert(
        {
          user_id: userId,
          provider,
          encrypted_key: encryptedKey,
          model,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,provider' }
      )
      .select()
      .single()

    if (error) throw error

    return {
      provider: data.provider,
      model: data.model,
      isActive: data.is_active,
      maskedKey: maskKey(decrypt(data.encrypted_key)),
      updatedAt: data.updated_at,
    }
  }

  async listApiKeys({ userId }: { userId: string }): Promise<UserKeyMeta[]> {
    const { data, error } = await supabaseAdmin
      .from('user_api_keys')
      .select()
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })

    if (error) throw error

    return data.map((row) => ({
      provider: row.provider,
      model: row.model,
      isActive: row.is_active,
      maskedKey: maskKey(decrypt(row.encrypted_key)),
      updatedAt: row.updated_at,
    }))
  }

  // Med7: if the deleted key was active and another provider key remains, promote
  // the most-recently-updated remaining key (order by updated_at desc limit 1).
  async deleteApiKey({ userId, provider }: { userId: string; provider: Provider }): Promise<void> {
    const { data: deleted, error: deleteError } = await supabaseAdmin
      .from('user_api_keys')
      .delete()
      .eq('user_id', userId)
      .eq('provider', provider)
      .select()
      .maybeSingle()

    if (deleteError) throw deleteError

    if (deleted?.is_active) {
      const { data: remaining, error: remainingError } = await supabaseAdmin
        .from('user_api_keys')
        .select('provider')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
        .limit(1)

      if (remainingError) throw remainingError

      const promote = remaining?.[0]
      if (promote) {
        const { error: promoteError } = await supabaseAdmin
          .from('user_api_keys')
          .update({ is_active: true })
          .eq('user_id', userId)
          .eq('provider', promote.provider)

        if (promoteError) throw promoteError
      }
    }
  }

  async setActiveProvider({ userId, provider }: { userId: string; provider: Provider }): Promise<void> {
    // Ensure the target key exists for this user.
    const { data: target, error: targetError } = await supabaseAdmin
      .from('user_api_keys')
      .select('id')
      .eq('user_id', userId)
      .eq('provider', provider)
      .maybeSingle()

    if (targetError) throw targetError
    if (!target) throw new Error(`no key for provider "${provider}"`)

    // Clear is_active on all of this user's keys, then set the chosen one.
    const { error: clearError } = await supabaseAdmin
      .from('user_api_keys')
      .update({ is_active: false })
      .eq('user_id', userId)

    if (clearError) throw clearError

    const { error: setError } = await supabaseAdmin
      .from('user_api_keys')
      .update({ is_active: true })
      .eq('user_id', userId)
      .eq('provider', provider)

    if (setError) throw setError
  }

  async getActiveKey({ userId }: { userId: string }): Promise<ActiveKey | null> {
    const { data, error } = await supabaseAdmin
      .from('user_api_keys')
      .select()
      .eq('user_id', userId)
      .eq('is_active', true)
      .maybeSingle()

    if (error) throw error
    if (!data) return null

    return {
      provider: data.provider,
      model: data.model,
      apiKey: decrypt(data.encrypted_key),
    }
  }
}
