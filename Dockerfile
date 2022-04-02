FROM node:17-alpine3.14
WORKDIR /usr/src/app
RUN apk add git
RUN mkdir repos
WORKDIR /usr/src/app/repos
RUN git clone https://github.com/ev3nvy/valorant-xmpp-client.git
WORKDIR /usr/src/app/repos/valorant-xmpp-client
RUN npm i
RUN npm run build
RUN npm link
WORKDIR /usr/src/app
RUN mkdir cypher
WORKDIR /usr/src/app/cypher
COPY package.json .
RUN npm link valorant-xmpp-client
RUN npm i
COPY . .
CMD ["npm","start"]
