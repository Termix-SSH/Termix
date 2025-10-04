FROM ubuntu:22.04

# 避免交互式提示
ENV DEBIAN_FRONTEND=noninteractive

# 安装SSH服务器和Google Authenticator
RUN apt-get update && apt-get install -y \
    openssh-server \
    libpam-google-authenticator \
    qrencode \
    && rm -rf /var/lib/apt/lists/*

# 创建测试用户
RUN useradd -m -s /bin/bash testuser && \
    echo 'testuser:testpass' | chpasswd

# 创建SSH运行目录
RUN mkdir -p /var/run/sshd

# 配置SSH支持键盘交互认证（TOTP需要）
RUN sed -i 's/#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config && \
    sed -i 's/UsePAM no/UsePAM yes/' /etc/ssh/sshd_config && \
    sed -i 's/#KbdInteractiveAuthentication yes/KbdInteractiveAuthentication yes/' /etc/ssh/sshd_config && \
    sed -i 's/KbdInteractiveAuthentication no/KbdInteractiveAuthentication yes/' /etc/ssh/sshd_config && \
    sed -i 's/#ChallengeResponseAuthentication yes/ChallengeResponseAuthentication yes/' /etc/ssh/sshd_config && \
    sed -i 's/ChallengeResponseAuthentication no/ChallengeResponseAuthentication yes/' /etc/ssh/sshd_config

# 强制使用键盘交互认证（这样会触发TOTP）
RUN echo 'AuthenticationMethods keyboard-interactive' >> /etc/ssh/sshd_config

# 配置PAM使用Google Authenticator进行TOTP验证
# 先验证密码，再验证TOTP（双因素认证）
RUN sed -i 's/@include common-auth/#@include common-auth/' /etc/pam.d/sshd && \
    sed -i '/#@include common-auth/a auth required pam_unix.so\nauth required pam_google_authenticator.so' /etc/pam.d/sshd

# 为testuser预配置TOTP密钥
# 密钥: JBSWY3DPEHPK3PXP (Base32编码)
# 这会在Google Authenticator中显示为6位数字验证码
RUN su - testuser -c "mkdir -p ~/.ssh" && \
    echo 'JBSWY3DPEHPK3PXP' > /home/testuser/.google_authenticator && \
    echo '" RATE_LIMIT 3 30' >> /home/testuser/.google_authenticator && \
    echo '" WINDOW_SIZE 17' >> /home/testuser/.google_authenticator && \
    echo '" DISALLOW_REUSE' >> /home/testuser/.google_authenticator && \
    echo '" TOTP_AUTH' >> /home/testuser/.google_authenticator && \
    echo '12345678' >> /home/testuser/.google_authenticator && \
    echo '12345679' >> /home/testuser/.google_authenticator && \
    echo '12345680' >> /home/testuser/.google_authenticator && \
    echo '12345681' >> /home/testuser/.google_authenticator && \
    echo '12345682' >> /home/testuser/.google_authenticator && \
    chown testuser:testuser /home/testuser/.google_authenticator && \
    chmod 600 /home/testuser/.google_authenticator

# 暴露SSH端口
EXPOSE 22

# 启动SSH服务器
CMD ["/usr/sbin/sshd", "-D", "-e"]
