FROM node:8-alpine

COPY ./package.json ./yarn.lock /app/
RUN cd /app && yarn install && yarn build && rm -rf /root/.cache /root/.npm

COPY . /app

ENV PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/app/bin

WORKDIR /app
