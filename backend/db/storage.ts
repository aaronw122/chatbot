import type { Message, Messages, Conversation, CreateConversation, MessageType, Content, CleanMessage, Provider, UserKeyMeta, Highlight, CreateHighlight } from '../../types/types'
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

  createConversation({ content, userId, save }: CreateConversation): Promise<Conversation>

  getMessages({ convoId }: { convoId: string }): Promise<Message[] | []>

  // Fetch a single message by id (branch context assembly dereferences a
  // highlight's source message to its full content). Null if not found.
  getMessage({ id }: { id: string }): Promise<CleanMessage | null>

  getConversations({ userId }: { userId: string }): Promise<Conversation[]>

  getConversation({ convoId }: { convoId: string }): Promise<Conversation | null>

  saveConversation({ convoId }: { convoId: string }): Promise<Conversation>

  deleteConversation({ convoId }: { convoId: string }): Promise<void>

  // ----- Branch-anchored highlights -----
  // Insert a highlight and return the persisted row (camelCase).
  createHighlight({ messageId, branchConvoId, startOffset, endOffset, quote, userId }: CreateHighlight): Promise<Highlight>

  // All highlights whose source message belongs to `convoId` (for rendering
  // marks when a conversation loads).
  getHighlightsByConvo(convoId: string): Promise<Highlight[]>

  // The single highlight that opened `branchConvoId` (for generation-time
  // context assembly), or null.
  getHighlightByBranch(branchConvoId: string): Promise<Highlight | null>

  // BYOK (Phase 1) — per-user encrypted API key CRUD.
  // MF5: upsertApiKey never reads or writes is_active. Activation happens only via
  // the "first key" branch in POST /api/keys or explicit setActiveProvider.
  upsertApiKey({ userId, provider, encryptedKey, model }: { userId: string; provider: Provider; encryptedKey: string; model: string }): Promise<UserKeyMeta>

  listApiKeys({ userId }: { userId: string }): Promise<UserKeyMeta[]>

  deleteApiKey({ userId, provider }: { userId: string; provider: Provider }): Promise<void>

  // Set the chosen provider active; clear is_active on all others for the user.
  // When `model` is provided, also persist it onto the existing (userId, provider)
  // row — the same row getActiveKey reads — without re-encrypting/touching the key.
  // Throws if no key row exists for (userId, provider).
  setActiveProvider({ userId, provider, model }: { userId: string; provider: Provider; model?: string }): Promise<void>

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
  // Branch-anchored highlights, keyed by highlight id.
  private highlights: Map<string, Highlight> = new Map()

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
      // `?? true` (not `save ? save : true`) so an explicit `save: false` is
      // honored — branch conversations are created hidden (save:false).
      save: save ?? true
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

    const userConvos = convoArr.filter(el => el.userId === userId && el.save !== false)

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

  async getMessage({ id }: { id: string }): Promise<CleanMessage | null> {
    const msg = this.messages.get(id)
    if (!msg) return null
    return {
      id: msg.id,
      convoId: msg.convoId,
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: typeof msg.content === 'string'
        ? msg.content
        : (Array.isArray(msg.content) && msg.content[0] && 'text' in msg.content[0]
            ? String((msg.content[0] as { text: unknown }).text)
            : ''),
      createdAt: msg.createdAt,
    }
  }

  // ----- Branch-anchored highlights -----

  async createHighlight({ messageId, branchConvoId, startOffset, endOffset, quote, userId }: CreateHighlight): Promise<Highlight> {
    if (endOffset <= startOffset) {
      throw new Error('end_offset must be greater than start_offset')
    }
    const highlight: Highlight = {
      id: crypto.randomUUID(),
      messageId,
      branchConvoId,
      startOffset,
      endOffset,
      quote,
      userId: userId ?? null,
      createdAt: new Date().toISOString(),
    }
    this.highlights.set(highlight.id, highlight)
    return highlight
  }

  async getHighlightsByConvo(convoId: string): Promise<Highlight[]> {
    // Highlights whose source message belongs to this conversation.
    const convoMessageIds = new Set(
      [...this.messages.values()].filter((m) => m.convoId === convoId).map((m) => m.id)
    )
    return [...this.highlights.values()].filter((h) => convoMessageIds.has(h.messageId))
  }

  async getHighlightByBranch(branchConvoId: string): Promise<Highlight | null> {
    return [...this.highlights.values()].find((h) => h.branchConvoId === branchConvoId) ?? null
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

  // Simulate `message_id ... on delete cascade`: deleting a message also deletes
  // any highlights anchored to it (marks vanish cleanly on regenerate/delete).
  // The branch conversation linked by those highlights survives — it is a
  // separate conversations row.
  async deleteMessage({ id }: { id: string }) {
    this.messages.delete(id)
    for (const h of [...this.highlights.values()]) {
      if (h.messageId === id) {
        this.highlights.delete(h.id)
      }
    }
  }

  async deleteConversation({ convoId }: { convoId: string }) {
    //need to both delete the convo and the messages with its id
    const messageArr = [...this.messages.values()]

    const messagesToDelete = messageArr.filter(el => el.convoId === convoId)

    // Cascade as the DB does: deleting a message deletes highlights anchored to
    // it (message_id cascade); deleting the convo deletes highlights whose
    // branch_convo_id is this convo (branch_convo_id cascade).
    const deletedMessageIds = new Set(messagesToDelete.map((el) => el.id))
    for (const h of [...this.highlights.values()]) {
      if (deletedMessageIds.has(h.messageId) || h.branchConvoId === convoId) {
        this.highlights.delete(h.id)
      }
    }

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
    this.highlights = new Map()
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

  async setActiveProvider({ userId, provider, model }: { userId: string; provider: Provider; model?: string }): Promise<void> {
    const target = this.apiKeys.get(this.keyOf(userId, provider))
    if (!target) {
      throw new Error(`no key for provider "${provider}"`)
    }
    // Persist the chosen model onto the existing row (never touches encryptedKey).
    if (model !== undefined) {
      target.model = model
      target.updatedAt = new Date().toISOString()
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
      .eq('save', true)
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
  async getMessage({ id }: { id: string }): Promise<CleanMessage | null> {
    const { data, error } = await supabaseAdmin
      .from('messages')
      .select()
      .eq('id', id)
      .maybeSingle()

    if (error) throw error
    if (!data) return null

    return {
      id: data.id,
      convoId: data.convo_id,
      role: data.role,
      content: data.content,
      createdAt: data.created_at,
    }
  }

  // ----- Branch-anchored highlights (camelCase ↔ snake_case mapping) -----

  async createHighlight({ messageId, branchConvoId, startOffset, endOffset, quote, userId }: CreateHighlight): Promise<Highlight> {
    const { data, error } = await supabaseAdmin
      .from('highlights')
      .insert({
        message_id: messageId,
        branch_convo_id: branchConvoId,
        start_offset: startOffset,
        end_offset: endOffset,
        quote,
        user_id: userId ?? null,
      })
      .select()
      .single()

    if (error) throw error

    return {
      id: data.id,
      messageId: data.message_id,
      branchConvoId: data.branch_convo_id,
      startOffset: data.start_offset,
      endOffset: data.end_offset,
      quote: data.quote,
      userId: data.user_id,
      createdAt: data.created_at,
    }
  }

  async getHighlightsByConvo(convoId: string): Promise<Highlight[]> {
    // Highlights whose source message belongs to `convoId`. Resolve the convo's
    // message ids first, then fetch highlights anchored to any of them.
    const { data: msgs, error: msgErr } = await supabaseAdmin
      .from('messages')
      .select('id')
      .eq('convo_id', convoId)

    if (msgErr) throw msgErr
    const messageIds = (msgs ?? []).map((m) => m.id)
    if (messageIds.length === 0) return []

    const { data, error } = await supabaseAdmin
      .from('highlights')
      .select()
      .in('message_id', messageIds)
      .order('created_at', { ascending: true })

    if (error) throw error

    return (data ?? []).map((row) => ({
      id: row.id,
      messageId: row.message_id,
      branchConvoId: row.branch_convo_id,
      startOffset: row.start_offset,
      endOffset: row.end_offset,
      quote: row.quote,
      userId: row.user_id,
      createdAt: row.created_at,
    }))
  }

  async getHighlightByBranch(branchConvoId: string): Promise<Highlight | null> {
    const { data, error } = await supabaseAdmin
      .from('highlights')
      .select()
      .eq('branch_convo_id', branchConvoId)
      .maybeSingle()

    if (error) throw error
    if (!data) return null

    return {
      id: data.id,
      messageId: data.message_id,
      branchConvoId: data.branch_convo_id,
      startOffset: data.start_offset,
      endOffset: data.end_offset,
      quote: data.quote,
      userId: data.user_id,
      createdAt: data.created_at,
    }
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

  async deleteConversation({ convoId }: { convoId: string }): Promise<void> {
    const { error } = await supabaseAdmin
      .from('conversations')
      .delete()
      .eq('id', convoId)

    if (error) throw error
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

  async setActiveProvider({ userId, provider, model }: { userId: string; provider: Provider; model?: string }): Promise<void> {
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

    // Set the chosen provider active and, when provided, persist the new model
    // onto the same row getActiveKey reads. encrypted_key is never touched.
    const update: { is_active: true; model?: string; updated_at?: string } = { is_active: true }
    if (model !== undefined) {
      update.model = model
      update.updated_at = new Date().toISOString()
    }
    const { error: setError } = await supabaseAdmin
      .from('user_api_keys')
      .update(update)
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
