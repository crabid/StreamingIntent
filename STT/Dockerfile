FROM node:12

WORKDIR /app/models
COPY model_list /app/models
RUN wget -nv -i ./model_list

WORKDIR /app
COPY package.json /app
RUN yarn install
COPY server.js /app
CMD node server.js
EXPOSE 4000
