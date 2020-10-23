FROM rasa/rasa

WORKDIR /app
COPY . /app

# Preferred syntax in the next line -- for some reason the --cors argument isn't registered
#CMD ["/opt/venv/bin/rasa", "run", "--enable-api", "--cors=*"]
CMD rasa run --enable-api --cors=*
EXPOSE 5005

# Remove entrypoint from parent image. For some reason this cause the cache to be invalidated every time
ENTRYPOINT []
