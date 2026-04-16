from chat.chat_app import create_chat_app


if __name__ == "__main__":
    app = create_chat_app()
    app.run(host="0.0.0.0", port=8080, debug=False, threaded=True)
