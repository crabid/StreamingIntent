FROM tensorflow/tensorflow:latest-gpu

#Install nodejs
RUN curl -sL https://deb.nodesource.com/setup_12.x | bash -
RUN apt update && apt install -y nodejs

#Install yarn
RUN curl -sS https://dl.yarnpkg.com/debian/pubkey.gpg | apt-key add -
RUN echo "deb https://dl.yarnpkg.com/debian/ stable main" | tee /etc/apt/sources.list.d/yarn.list
RUN apt update && apt -y install yarn

#Install wget
RUN apt install -y wget

WORKDIR /app/models
COPY model_list /app/models
RUN wget -nv -i ./model_list

WORKDIR /app
COPY package.json /app
RUN yarn install
COPY . /app
CMD node server.js
EXPOSE 4000
