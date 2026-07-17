FROM pi-clouds/agent-runner:pi
COPY models.json /root/.pi/agent/models.json
COPY settings.json /root/.pi/agent/settings.json
COPY entrypoint-gw.sh /app/entrypoint-gw.sh
RUN chmod +x /app/entrypoint-gw.sh
ENTRYPOINT ["/app/entrypoint-gw.sh"]
