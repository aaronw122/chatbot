import axios from 'axios'

const baseURL = 'http://localhost:3000'

const getAllMessages = async () => {
  const response = await axios.get(`${baseURL}/chat`)
  return response.data
}

const sendMessage = async (newReq:{content: string}) => {
  const response = await axios.post(`${baseURL}/chat`, newReq)
  return response.data
}

const resetMessages = async () => {
  const response = await axios.post(`${baseURL}/reset`)
  return response.data
}

export default {getAllMessages, sendMessage, resetMessages}
