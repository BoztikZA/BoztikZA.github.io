/* ===========================================================
   BOZTIK CREATIVE ASSISTANT
   App Controller
=========================================================== */

document.addEventListener("DOMContentLoaded", () => {

    Boztik.init();

});

const Boztik = {

    chat: [],

    init() {

        this.cache();

        this.events();

        this.restoreChat();

        this.welcome();

    },

    cache() {

        this.messages =
            document.querySelector(".messages");

        this.input =
            document.querySelector(".chat-input input");

        this.send =
            document.querySelector(".chat-input button");

        this.sidebarButtons =
            document.querySelectorAll(".sidebar button");

        this.toolCards =
            document.querySelectorAll(".tool-card");

    },

    events() {

        this.send.addEventListener("click", () => {

            this.sendMessage();

        });

        this.input.addEventListener("keydown", (e) => {

            if (e.key === "Enter") {

                e.preventDefault();

                this.sendMessage();

            }

        });

        this.sidebarButtons.forEach(button => {

            button.addEventListener("click", () => {

                this.sidebarButtons.forEach(b =>
                    b.classList.remove("active")
                );

                button.classList.add("active");

            });

        });

        this.toolCards.forEach(card => {

            card.addEventListener("click", () => {

                const title =
                    card.querySelector("h3").innerText;

                this.input.value =
                    "Help me with " + title;

                this.input.focus();

            });

        });

    },

    sendMessage() {

        const text =
            this.input.value.trim();

        if (!text) return;

        this.addUser(text);

        this.input.value = "";

        this.typing();

        setTimeout(() => {

            this.removeTyping();

            this.reply(text);

        },1200);

    },

    addUser(text){

        const div=document.createElement("div");

        div.className="user-message";

        div.innerText=text;

        this.messages.appendChild(div);

        this.scroll();

        this.chat.push({

            type:"user",

            text

        });

        this.save();

    },

    addAssistant(text){

        const div=document.createElement("div");

        div.className="assistant-message";

        div.innerText=text;

        this.messages.appendChild(div);

        this.scroll();

        this.chat.push({

            type:"assistant",

            text

        });

        this.save();

    },

    typing(){

        const div=document.createElement("div");

        div.className="assistant-message";

        div.id="typing";

        div.innerHTML="Thinking...";

        this.messages.appendChild(div);

        this.scroll();

    },

    removeTyping(){

        const typing=document.getElementById("typing");

        if(typing) typing.remove();

    },

    reply(message){

        const text=message.toLowerCase();

        let response="That's a great creative question. AI providers will answer this in Part 4.";

        if(text.includes("photoshop"))

            response="Photoshop tip: Use Smart Objects and Adjustment Layers whenever possible to keep your edits non-destructive.";

        else if(text.includes("firefly"))

            response="A good Firefly prompt includes the subject, lighting, camera angle, mood, quality and style.";

        else if(text.includes("background"))

            response="Start with Select Subject, refine edges, then clean the mask manually for the best results.";

        else if(text.includes("portrait"))

            response="For portraits, focus on natural skin tones, subtle dodge and burn, and controlled sharpening.";

        else if(text.includes("export"))

            response="JPEG for web, PNG for transparency, TIFF for print, PSD for editable masters.";

        this.addAssistant(response);

    },

    welcome(){

        if(this.chat.length>0) return;

        this.addAssistant(
            "👋 Welcome to Boztik Creative Assistant.\n\nHow can I help with your next creative project?"
        );

    },

    scroll(){

        this.messages.scrollTop=
            this.messages.scrollHeight;

    },

    save(){

        localStorage.setItem(

            "boztik-chat",

            JSON.stringify(this.chat)

        );

    },

    restoreChat(){

        const saved=

            localStorage.getItem("boztik-chat");

        if(!saved) return;

        this.chat=

            JSON.parse(saved);

        this.messages.innerHTML="";

        this.chat.forEach(msg=>{

            if(msg.type==="user")

                this.addBubble(msg.text,"user-message");

            else

                this.addBubble(msg.text,"assistant-message");

        });

    },

    addBubble(text,cls){

        const div=document.createElement("div");

        div.className=cls;

        div.innerText=text;

        this.messages.appendChild(div);

        this.scroll();

    }

};