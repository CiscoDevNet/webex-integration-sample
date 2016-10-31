
default: run

run:
	DEBUG=oauth* REDIRECT_URI="http://localhost:8080/oauth" CLIENT_ID="C9901101c66249d7e6b7cb174941a400e2e01f7d80d0b1f08b11665bad5cbb66d" CLIENT_SECRET="aaa8f0304a9b49a1654b74a14faf7b939481341ab09c9e47bab9d7c1e54e62a7" node server.js