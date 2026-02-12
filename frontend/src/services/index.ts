import axios from 'axios'

const baseURL = 'http://localhost:3000'

const getConvos = async () => {
  const response = await axios.get(`${baseURL}/conversations`)
  return response.data
}

const createConvo = async (convoReq: {content: string, save?: true | false}) => {
  const response = await axios.post(`${baseURL}/conversations`, convoReq)
  return response.data
}

const getMessages = async (convoId : string) => {
  const response = await axios.get(`${baseURL}/messages/${convoId}`)
  return response.data
}

const sendMessage = async (newReq: { content: string, role: "user" | "assistant", convoId: string }) => {
  const response = await axios.post(`${baseURL}/messages/${newReq.convoId}`, newReq)
  return response.data
}

const resetMessages = async () => {
  const response = await axios.post(`${baseURL}/reset`)
  return response.data
}

//add later if time
const deleteMessage = async (convoId: string) => {

}

export default {getMessages, sendMessage, resetMessages, getConvos, createConvo}
