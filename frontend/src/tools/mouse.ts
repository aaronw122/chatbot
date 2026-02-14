const assistantMessage = document.getElementById("role-assistant")

if (assistantMessage) {
  assistantMessage.addEventListener("mouseup", (event) => {
    console.log('mouseUp is working', event)
  })
}
