scp -i /home/tekware/.ssh/id_tk_rsa -r backend/notifications buntu@sharedlist.ovh:/home/ubuntu/sharedlist/backend/
scp -i /home/tekware/.ssh/id_tk_rsa -r backend/templates buntu@sharedlist.ovh:/home/ubuntu/sharedlist/backend/
scp -i /home/tekware/.ssh/id_tk_rsa -r backend/*.py buntu@sharedlist.ovh:/home/ubuntu/sharedlist/backend/
scp -i /home/tekware/.ssh/id_tk_rsa -r secrets buntu@sharedlist.ovh:/home/ubuntu/sharedlist/
