import axios from 'axios'

async function main() {
    try {
        const bufferClients = await axios.get('http://localhost:3000/bufferClients');
        console.log(bufferClients.data)

        for (const client of bufferClients.data) {
            const userresp = await axios.get(`http://localhost:3000/user/${client.tgId}`);
            console.log(userresp.data.lastActive)
        }
    } catch (error) {
        console.log(error)
    }
}

main()